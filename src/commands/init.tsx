/**
 * ## Init Command
 *
 * Scaffolds a new project for a system.
 *
 * With slug:  100xsystems init <slug> [options]  → direct scaffolding
 * Without:    100xsystems init                     → interactive wizard
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from '../ui/SelectInput.js';
import zod from 'zod';
import { option } from 'pastel';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { getAllSystems, systemExists, getSystemMeta } from '../reader/system-reader.js';
import { getSystemTracks } from '../reader/lesson-reader.js';
import { syncSystemFromRegistry, fetchRegistry } from '../reader/index.js';
import { scaffoldProject } from '../scaffold/index.js';
import { getCachedUser } from '../auth/index.js';
import { markInProgress } from '../actions/progress.js';

export const args = zod.tuple([
  zod.string().optional().describe('Optional system slug (e.g., claude-code). Omit for interactive selection.'),
]);

export const options = zod.object({
  output: zod.string().optional().describe(
    option({ description: 'Output directory', alias: 'o' }),
  ),
  author: zod.string().optional().describe(
    option({ description: 'Your GitHub username (for templates)', alias: 'a' }),
  ),
});

type Props = {
  args: zod.infer<typeof args>;
  options: zod.infer<typeof options>;
};

// ─── Wizard Phases ──────────────────────────────────────────────────

type InitPhase =
  | { name: 'loading' }
  | { name: 'pick-system' }
  | { name: 'pick-track'; systemSlug: string; systemTitle: string; tracks: Array<{ slug: string; title: string; language: string }> }
  | { name: 'confirm'; systemSlug: string; systemTitle: string; trackSlug: string; trackTitle: string; language: string }
  | { name: 'scaffolding'; systemSlug: string; systemTitle: string; trackSlug: string; trackTitle: string; language: string; outputDir: string }
  | { name: 'done'; systemSlug: string; systemTitle: string; trackSlug: string; outputDir: string; created: string[] }
  | { name: 'error'; message: string };

// ─── Main Component ─────────────────────────────────────────────────

export default function Init({ args, options }: Props) {
  const [systemSlug] = args;
  const [phase, setPhase] = useState<InitPhase>({ name: 'loading' });

  useEffect(() => {
    (async () => {
      // Check dependencies first
      const missing = checkDependencies();
      if (missing.length > 0) {
        setPhase({ name: 'error', message: `Missing dependencies: ${missing.join(', ')}. Install them and try again.` });
        return;
      }

      // Sync systems from registry (best-effort)
      try {
        const registry = await fetchRegistry();
        if (registry.systems) {
          for (const sys of registry.systems) {
            try { await syncSystemFromRegistry(sys.slug, sys.repo); } catch {}
          }
        }
      } catch {}

      // Now proceed with normal flow
      if (systemSlug) {
        // Direct mode — check if system has tracks, then scaffold
        if (!systemExists(systemSlug)) {
          setPhase({ name: 'error', message: `System "${systemSlug}" not found.` });
          return;
        }
        const tracks = getSystemTracks(systemSlug);
        if (tracks.length === 0) {
          setPhase({ name: 'error', message: `No tracks found for system "${systemSlug}".` });
          return;
        }
        // Use first track by default in direct mode
        const track = tracks[0];
        doScaffold(systemSlug, track.slug, track.language, options.output, options.author, setPhase);
      } else {
        // Interactive mode — start with system picker
        setPhase({ name: 'pick-system' });
      }
    })();
  }, []);

  // ─── Phase renders ─────────────────────────────────────────────

  if (phase.name === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Initializing...</Text>
      </Box>
    );
  }

  if (phase.name === 'pick-system') {
    const systems = getAllSystems();
    if (systems.length === 0) {
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text color="yellow">  No systems found in curriculum.</Text>
          <Text dimColor>  Ensure the curriculum/ directory exists with system folders.</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="cyan">{'  '}⚡ Choose a System</Text>
        <Box marginY={1} />
        <Text dimColor>{'  '}Select which system you want to build:</Text>
        <Box marginY={1} />
        <Box marginLeft={2}>
          <SelectInput
            items={systems.map(s => ({
              label: `  ${s.title}${s.difficulty ? `  — ${s.difficulty}` : ''}${s.tags.length > 0 ? `  (${s.tags.slice(0, 3).join(', ')})` : ''}`,
              value: s.slug,
            }))}
            onSelect={(item) => {
              const system = getSystemMeta(item.value)!;
              const tracks = getSystemTracks(item.value);
              if (tracks.length > 1) {
                setPhase({ name: 'pick-track', systemSlug: item.value, systemTitle: system.title, tracks: tracks.map(t => ({ slug: t.slug, title: t.title, language: t.language })) });
              } else if (tracks.length === 1) {
                const track = tracks[0];
                setPhase({ name: 'confirm', systemSlug: item.value, systemTitle: system.title, trackSlug: track.slug, trackTitle: track.title, language: track.language });
              } else {
                setPhase({ name: 'error', message: `No tracks found for system "${item.value}".` });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.name === 'pick-track') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="cyan">{'  '}⚡ Choose a Track</Text>
        <Box marginY={1} />
        <Text dimColor>{'  '}Which track for <Text bold>{phase.systemTitle}</Text>?</Text>
        <Box marginY={1} />
        <Box marginLeft={2}>
          <SelectInput
            items={phase.tracks.map((t) => ({
              label: `  ${t.title}`,
              value: t.slug,
            }))}
            onSelect={(item) => {
              const track = phase.tracks.find(t => t.slug === item.value);
              setPhase({ name: 'confirm', systemSlug: phase.systemSlug, systemTitle: phase.systemTitle, trackSlug: item.value, trackTitle: track?.title || item.value, language: track?.language || '' });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.name === 'confirm') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="green">{'  '}⚡ Ready to Scaffold</Text>
        <Box marginY={1} />
        <Box flexDirection="column" marginLeft={2}>
          <Text>System: <Text bold>{phase.systemTitle}</Text></Text>
          <Text>Track:  <Text bold>{phase.trackTitle}</Text></Text>
          <Text>Output: <Text bold>./{phase.systemSlug}-implementation</Text></Text>
        </Box>
        <Box marginY={1} />
        <Box marginLeft={2}>
          <SelectInput
            items={[
              { label: '  ✅ Yes, scaffold it!', value: 'yes' },
              { label: '  ❌ Cancel', value: 'no' },
            ]}
            onSelect={(item) => {
              if (item.value === 'yes') {
                setPhase({ name: 'scaffolding', systemSlug: phase.systemSlug, systemTitle: phase.systemTitle, trackSlug: phase.trackSlug, trackTitle: phase.trackTitle, language: phase.language, outputDir: `./${phase.systemSlug}-implementation` });
              } else {
                setPhase({ name: 'error', message: 'Scaffolding cancelled.' });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (phase.name === 'scaffolding') {
    doScaffold(phase.systemSlug, phase.trackSlug, phase.language, undefined, undefined, setPhase);
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Scaffolding {phase.systemTitle}...</Text>
      </Box>
    );
  }

  if (phase.name === 'done') {
    const { systemTitle, trackSlug, outputDir, created } = phase;
    const code = created.filter((f) => f.startsWith('src/') || f === 'package.json' || f === 'tsconfig.json');
    const configs = created.filter((f) => f.startsWith('.'));

    const children: React.ReactNode[] = [];
    children.push(<Text bold key="h">{'  '}100xSystems — &ldquo;{systemTitle}&rdquo; initialized</Text>);
    children.push(<Box key="sp1" marginY={1} />);
    children.push(<Text color="green" key="ok">{'  '}✓ Project created successfully!</Text>);
    children.push(<Box key="sp2" marginY={1} />);
    children.push(<Text key="track" dimColor>{'  '}Track: {trackSlug}</Text>);
    children.push(<Box key="sp2b" marginY={1} />);

    if (configs.length > 0) {
      children.push(<Text key="cfgh" dimColor>{'  '}Config:</Text>);
      for (const f of configs) children.push(<Text key={`cfg-${f}`}>{'    '}⚙️  {f}</Text>);
      children.push(<Box key="sp5" marginY={1} />);
    }
    if (code.length > 0) {
      children.push(<Text key="ch" dimColor>{'  '}Code:</Text>);
      for (const f of code) children.push(<Text key={`c-${f}`}>{'    '}📄 {f}</Text>);
      children.push(<Box key="sp4" marginY={1} />);
    }

    children.push(<Text bold key="nx">Next steps:</Text>);
    children.push(<Text key="ns1" color="cyan">{'  '}cd {outputDir.replace('./', '')}</Text>);
    children.push(<Text key="ns2" color="cyan">{'  '}100x validate  <Text dimColor>→ pick a lesson and validate</Text></Text>);
    children.push(<Box key="sp6" marginY={1} />);
    children.push(<Text key="sub" dimColor>Ready to submit? <Text color="cyan">100x submit</Text> to create a review package</Text>);

    return <Box flexDirection="column" paddingX={2}>{children}</Box>;
  }

  if (phase.name === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color={phase.message === 'Scaffolding cancelled.' ? 'yellow' : 'red'}>  {phase.message}</Text>
      </Box>
    );
  }

  return null;
}

// ─── Scaffolding Logic (shared with direct mode) ────────────────────

function checkDependencies(): string[] {
  const missing: string[] = [];
  try { execSync('node --version', { stdio: 'pipe', timeout: 3000 }); } catch { missing.push('Node.js'); }
  try { execSync('npm --version', { stdio: 'pipe', timeout: 3000 }); } catch { missing.push('npm'); }
  try { execSync('git --version', { stdio: 'pipe', timeout: 3000 }); } catch { missing.push('Git'); }
  return missing;
}

async function doScaffold(
  systemSlug: string,
  trackSlug: string,
  language: string,
  outputOverride: string | undefined,
  authorOverride: string | undefined,
  setPhase: (phase: InitPhase) => void,
): Promise<void> {
  if (!systemExists(systemSlug)) {
    setPhase({ name: 'error', message: `System "${systemSlug}" not found.` });
    return;
  }

  const system = getSystemMeta(systemSlug)!;
  const outputDir = outputOverride || `./${systemSlug}-implementation`;
  const targetDir = path.resolve(process.cwd(), outputDir);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    setPhase({ name: 'error', message: `Directory "${outputDir}" already exists. Use --output to specify a different path.` });
    return;
  }

  const cachedUser = getCachedUser();
  const author = authorOverride || cachedUser?.login || '';

  try {
    const created = scaffoldProject({
      targetDir,
      systemSlug,
      systemTitle: system.title,
      trackSlug,
      language,
      author,
    });

    markInProgress(systemSlug, targetDir, trackSlug);
    setPhase({ name: 'done', systemSlug, systemTitle: system.title, trackSlug, outputDir, created });
  } catch (err: any) {
    setPhase({ name: 'error', message: `Failed to create project: ${err.message}` });
  }
}

/**
 * ## Audit Solutions Command
 *
 * Generates a `.solution-manifest.json` documenting what each lesson's
 * test file expects. This manifest enables drift detection between
 * test files and solution files.
 *
 * Usage:
 *   100xsystems audit-solutions <system> [track]
 *
 * Examples:
 *   100xsystems audit-solutions claude-code
 *   100xsystems audit-solutions claude-code track-typescript
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import zod from 'zod';
import { generateManifest, writeManifest, diffManifests, readManifest } from '../actions/audit-solutions.js';
import { getSystemTracks } from '../reader/lesson-reader.js';
import { systemExists } from '../reader/system-reader.js';

export const args = zod.tuple([
  zod.string().describe('System slug (e.g., claude-code)'),
  zod.string().optional().describe('Track slug (e.g., track-typescript). Omit for all tracks.'),
]);

type Props = {
  args: zod.infer<typeof args>;
};

export default function AuditSolutions({ args }: Props) {
  const [systemSlug] = args;
  const [phase, setPhase] = useState<
    { name: 'loading' } |
    { name: 'done'; manifestPath: string; track: string; diff: string; lessonCount: number } |
    { name: 'error'; message: string }
  >({ name: 'loading' });

  useEffect(() => {
    (async () => {
      const trackSlug = args[1] || '';

      if (!systemExists(systemSlug)) {
        setPhase({ name: 'error', message: `System "${systemSlug}" not found.` });
        return;
      }

      const tracks = trackSlug
        ? [{ slug: trackSlug }]
        : getSystemTracks(systemSlug);

      if (tracks.length === 0) {
        setPhase({ name: 'error', message: `No tracks found for system "${systemSlug}".` });
        return;
      }

      const results: string[] = [];
      let totalLessons = 0;

      for (const track of tracks) {
        const slug = track.slug;
        const manifest = generateManifest(systemSlug, slug);
        const existingManifest = readManifest(systemSlug, slug);
        const diff = diffManifests(manifest, existingManifest);
        const manifestPath = writeManifest(systemSlug, slug, manifest);

        const lessonCount = Object.keys(manifest.lessons).length;
        totalLessons += lessonCount;

        let diffStr = '';
        if (diff.added.length > 0) diffStr += `\n    ➕ ${diff.added.length} lesson(s) added`;
        if (diff.removed.length > 0) diffStr += `\n    ➖ ${diff.removed.length} lesson(s) removed`;
        if (diff.changed.length > 0) diffStr += `\n    🔄 ${diff.changed.length} lesson(s) changed`;
        if (!diffStr) diffStr = '  (no changes)';

        results.push(`  Track: ${slug} — ${lessonCount} lesson(s) · ${manifestPath}${diffStr}`);
      }

      setPhase({
        name: 'done',
        manifestPath: results.join('\n'),
        track: trackSlug || 'all tracks',
        diff: results.join('\n'),
        lessonCount: totalLessons,
      });
    })();
  }, []);

  if (phase.name === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Auditing solutions for {systemSlug}...</Text>
      </Box>
    );
  }

  if (phase.name === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color="yellow">  {phase.message}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">{'  '}📋 Solution Manifest Generated</Text>
        <Box marginTop={1}>
          <Text color="green">{'  '}✓ System: {systemSlug}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="green">{'  '}✓ {phase.lessonCount} lesson(s) audited across {phase.track}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        <Text bold color="white">  Results</Text>
        <Box flexDirection="column">
          {phase.manifestPath.split('\n').map((line, i) => (
            <Text key={i} color="green">{'  '}{line}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{'  '}Commit the manifest file(s) to track changes.</Text>
        </Box>
      </Box>
    </Box>
  );
}

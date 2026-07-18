/**
 * ## Validate Command
 *
 * Automatically validates the current lesson from 100xsystems.json progress.
 * No interactive lesson picker — detects current lesson and runs validation
 * immediately. On success, advances progress to the next lesson.
 *
 * Flow:
 *   loading → validating → done
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ValidationReport } from '../ui/index.js';
import zod from 'zod';
import fs from 'fs';
import path from 'path';
import { readProjectConfig, PROJECT_CONFIG } from '../scaffold/index.js';
import { runValidation } from '../actions/validate.js';
import type { ValidationResult } from '../actions/validate.js';
import { getSystemTracks, getTrackModules } from '../reader/lesson-reader.js';
import { ensureAuthenticated } from '../auth/index.js';
import { API_BASE_URL } from '../config.js';

export const args = zod.tuple([]);

type Props = {
  args: zod.infer<typeof args>;
};

// ─── Wizard Phases ──────────────────────────────────────────────────

type ValidatePhase =
  | { name: 'loading' }
  | { name: 'validating'; config: Record<string, any>; lessonSlug: string; lessonTitle: string }
  | { name: 'done'; config: Record<string, any>; results: ValidationResult[]; lessonSlug: string; lessonTitle: string; advanced: boolean }
  | { name: 'error'; message: string };

// ─── Main Component ─────────────────────────────────────────────────

export default function Validate(_props: Props) {
  const [phase, setPhase] = useState<ValidatePhase>({ name: 'loading' });

  const updateProgress = (config: Record<string, any>, slug: string) => {
    const completed = (config.progress?.completedLessons as string[]) || [];
    if (!completed.includes(slug)) {
      completed.push(slug);
    }

    // Find the next lesson after this one
    const trackSlug = config.track || '';
    const sysSlug = (config.system as string) || '';
    const tracks = getSystemTracks(sysSlug);
    const track = tracks.find(t => t.slug === trackSlug) || tracks[0];
    let nextLesson = '';
    if (track) {
      const modules = getTrackModules(sysSlug, track.slug);
      const allLessons = modules.flatMap(m => m.lessons);
      const currentIdx = allLessons.findIndex(l => l.slug === slug);
      if (currentIdx >= 0 && currentIdx < allLessons.length - 1) {
        nextLesson = allLessons[currentIdx + 1].slug;
      } else {
        // Last lesson — mark completed, no next
        nextLesson = '';
      }
    }

    // Write updated config back to 100xsystems.json
    config.progress = {
      completedLessons: completed,
      currentLesson: nextLesson,
    };
    const configPath = path.join(process.cwd(), PROJECT_CONFIG);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  };

  useEffect(() => {
    const projectDir = process.cwd();
    const config = readProjectConfig(projectDir);

    if (!config) {
      setPhase({ name: 'error', message: `No ${PROJECT_CONFIG} found. Run \`100x init <system>\` first.` });
      return;
    }

    // Auto-detect current lesson from progress
    const slug = (config.system as string) || '';
    const trackSlug = (config.track as string) || '';
    const progress = config.progress || { completedLessons: [], currentLesson: '' };
    const completed: string[] = progress.completedLessons || [];
    const currentLesson: string = progress.currentLesson || '';

    const tracks = getSystemTracks(slug);
    const track = tracks.find(t => t.slug === trackSlug) || tracks[0];

    if (!track) {
      setPhase({ name: 'error', message: `No track found for this project. Ensure ${PROJECT_CONFIG} has a valid track field.` });
      return;
    }

    const modules = getTrackModules(slug, track.slug);
    const allLessons = modules.flatMap(m => m.lessons);

    if (allLessons.length === 0) {
      setPhase({ name: 'error', message: 'No lessons found in this track.' });
      return;
    }

    // Determine the first lesson that hasn't been completed
    const firstIncomplete = allLessons.find(l => !completed.includes(l.slug));
    const effectiveCurrent = currentLesson || firstIncomplete?.slug || allLessons[0].slug;
    const targetLesson = allLessons.find(l => l.slug === effectiveCurrent) || allLessons[0];

    // Go straight to validation — no interactive picker
    setPhase({
      name: 'validating',
      config,
      lessonSlug: targetLesson.slug,
      lessonTitle: targetLesson.title,
    });
  }, []);

  // ─── Phase renders ─────────────────────────────────────────────

  if (phase.name === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Validating...</Text>
      </Box>
    );
  }

  if (phase.name === 'validating') {
    // Trigger validation and move to done
    return <ValidatingRunner phase={phase} setPhase={setPhase} updateProgress={updateProgress} />;
  }

  if (phase.name === 'done') {
    const { results, lessonTitle, advanced } = phase;
    const failCount = results.filter(r => r.status === 'fail').length;
    const warnCount = results.filter(r => r.status === 'warn').length;
    const passCount = results.filter(r => r.status === 'pass').length;

    // Build level breakdown
    const level1 = results.filter(r => r.level === 1 || !r.level);
    const level2 = results.filter(r => r.level === 2);
    const level3 = results.filter(r => r.level === 3);

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">{'  '}📘 Validated: {lessonTitle}</Text>
          {advanced && (
            <Text color="green">{'  '}✓ Progress saved! Next lesson is now available.</Text>
          )}
          <Box marginTop={1}>
            <Text>
              {'  '}
              <Text color="green">{passCount} passed</Text>
              {warnCount > 0 && <Text> · <Text color="yellow">{warnCount} warnings</Text></Text>}
              {failCount > 0 && <Text> · <Text color="red">{failCount} failed</Text></Text>}
            </Text>
          </Box>
        </Box>

        {/* Three-Level Breakdown */}
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          <Text bold color="white">  Validation Levels</Text>
          <Box>
            <Text>{'    '}L1 Structure:</Text>
            <Text> </Text>
            <Text color="green">{level1.filter(r => r.status === 'pass').length} ✓</Text>
            {level1.filter(r => r.status === 'warn').length > 0 && <Text>, <Text color="yellow">{level1.filter(r => r.status === 'warn').length} ⚠</Text></Text>}
            {level1.filter(r => r.status === 'fail').length > 0 && <Text>, <Text color="red">{level1.filter(r => r.status === 'fail').length} ✗</Text></Text>}
          </Box>
          {level2.length > 0 && (
            <Box>
              <Text>{'    '}L2 Lesson:</Text>
              <Text> </Text>
              <Text color="green">{level2.filter(r => r.status === 'pass').length} ✓</Text>
              {level2.filter(r => r.status === 'warn').length > 0 && <Text>, <Text color="yellow">{level2.filter(r => r.status === 'warn').length} ⚠</Text></Text>}
              {level2.filter(r => r.status === 'fail').length > 0 && <Text>, <Text color="red">{level2.filter(r => r.status === 'fail').length} ✗</Text></Text>}
            </Box>
          )}
          {level3.length > 0 && (
            <Box>
              <Text>{'    '}L3 Spec:</Text>
              <Text> </Text>
              <Text color="green">{level3.filter(r => r.status === 'pass').length} ✓</Text>
              {level3.filter(r => r.status === 'warn').length > 0 && <Text>, <Text color="yellow">{level3.filter(r => r.status === 'warn').length} ⚠</Text></Text>}
              {level3.filter(r => r.status === 'fail').length > 0 && <Text>, <Text color="red">{level3.filter(r => r.status === 'fail').length} ✗</Text></Text>}
            </Box>
          )}
        </Box>

        <ValidationReport results={results} systemTitle={phase.config.systemTitle || ''} />
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

  return null;
}

// ─── Async Validating Runner (separated to use hooks in valid phase) ─

function ValidatingRunner({
  phase,
  setPhase,
  updateProgress,
}: {
  phase: { config: Record<string, any>; lessonSlug: string; lessonTitle: string };
  setPhase: (p: ValidatePhase) => void;
  updateProgress: (config: Record<string, any>, slug: string) => void;
}) {
  useEffect(() => {
    (async () => {
      const projectDir = process.cwd();
      const results = await runValidation(projectDir, phase.config, phase.lessonSlug);
      const failed = results.filter(r => r.status === 'fail').length;

      let advanced = false;
      if (failed === 0) {
        // Update progress locally
        updateProgress(phase.config, phase.lessonSlug);
        advanced = true;

        // Sync validation to server
        try {
          const auth = await ensureAuthenticated();
          if (auth.token) {
            const config = phase.config;
            const sysSlug = (config.system as string) || '';
            const trackSlug = (config.track as string) || '';
            await fetch(`${API_BASE_URL}/api/v1/user_progress`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`,
              },
              body: JSON.stringify({
                system_slug: sysSlug,
                track_slug: trackSlug,
                lesson_slug: phase.lessonSlug,
                is_validated: true,
              }),
            });
          }
        } catch {
          console.warn('  ⚠️  Failed to sync validation to server');
        }
      }

      setPhase({
        name: 'done',
        config: phase.config,
        results,
        lessonSlug: phase.lessonSlug,
        lessonTitle: phase.lessonTitle,
        advanced,
      });
    })();
  }, []);

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text dimColor>  Validating {phase.lessonTitle}...</Text>
    </Box>
  );
}

/**
 * ## Solution Command
 *
 * Interactive lesson picker that copies solution code from the curriculum
 * into the current project. For each lesson that has a `solution/`
 * directory in the curriculum, this command copies its contents into
 * the user's project root.
 *
 * Usage:
 *   100xsystems solution
 *
 * Flow:
 *   1. Reads 100xsystems.json from cwd to get system + track slugs
 *   2. Shows interactive lesson picker (like validate)
 *   3. User selects a lesson
 *   4. Copies files from curriculum lesson/solution/ → project root
 *   5. Reports what was copied
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from '../ui/SelectInput.js';
import zod from 'zod';
import fs from 'fs';
import path from 'path';
import { readProjectConfig, PROJECT_CONFIG } from '../scaffold/index.js';
import { SYSTEMS_DIR, fileToSlug } from '../reader/index.js';
import { getTrackFlatLessons, getTrackModules } from '../reader/lesson-reader.js';
import type { LessonMeta } from '../reader/lesson-reader.js';

export const args = zod.tuple([]);

type Props = {
  args: zod.infer<typeof args>;
};

// ─── Wizard Phases ──────────────────────────────────────────────────

type SolutionPhase =
  | { name: 'loading' }
  | { name: 'pick-lesson'; config: Record<string, any>; lessons: LessonMeta[]; completedSlugs: Set<string>; currentSlug: string }
  | { name: 'copying'; lessonTitle: string; lessonSlug: string }
  | { name: 'done'; lessonTitle: string; filesCopied: string[]; hasSolution: boolean }
  | { name: 'error'; message: string };

// ─── Main Component ─────────────────────────────────────────────────

export default function Solution(_props: Props) {
  const [phase, setPhase] = useState<SolutionPhase>({ name: 'loading' });

  useEffect(() => {
    const projectDir = process.cwd();
    const config = readProjectConfig(projectDir);

    if (!config) {
      setPhase({ name: 'error', message: `No ${PROJECT_CONFIG} found. Run \`100x init <system>\` first.` });
      return;
    }

    const sysSlug = (config.system as string) || '';
    const trackSlug = (config.track as string) || '';

    if (!sysSlug || !trackSlug) {
      setPhase({ name: 'error', message: '100xsystems.json is missing system or track field.' });
      return;
    }

    const progress = config.progress || { completedLessons: [], currentLesson: '' };
    const completed: string[] = progress.completedLessons || [];

    // Get lessons — try flat first, fall back to module-based
    let allLessons = getTrackFlatLessons(sysSlug, trackSlug);
    if (allLessons.length === 0) {
      const modules = getTrackModules(sysSlug, trackSlug);
      allLessons = modules.flatMap(m => m.lessons);
    }

    if (allLessons.length === 0) {
      setPhase({ name: 'error', message: 'No lessons found in this track.' });
      return;
    }

    const completedSlugs = new Set(completed);
    // The current lesson is the first one NOT in completedLessons
    const currentLesson = allLessons.find(l => !completedSlugs.has(l.slug));
    const currentSlug = currentLesson?.slug || allLessons[0].slug;

    setPhase({
      name: 'pick-lesson',
      config,
      lessons: allLessons,
      completedSlugs,
      currentSlug,
    });
  }, []);

  // ─── Copy solution files ────────────────────────────────────────

  const doCopySolution = (config: Record<string, any>, lesson: LessonMeta) => {
    setPhase({ name: 'copying', lessonTitle: lesson.title, lessonSlug: lesson.slug });

    const projectDir = process.cwd();
    const sysSlug = config.system as string;
    const trackSlug = config.track as string;

    // Resolve the lesson directory in the curriculum
    const systemsDir = SYSTEMS_DIR();
    const trackDir = path.join(systemsDir, sysSlug, trackSlug);

    if (!fs.existsSync(trackDir)) {
      setPhase({ name: 'error', message: `Curriculum directory not found for ${sysSlug}/${trackSlug}. Run \`100xsystems list\` to sync first.` });
      return;
    }    // Find the lesson folder by matching its slug
    let lessonDir: string | null = null;
    try {
      const entries = fs.readdirSync(trackDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const slug = fileToSlug(entry.name);
        if (slug === lesson.slug) {
          lessonDir = path.join(trackDir, entry.name);
          break;
        }
      }
    } catch {}

    if (!lessonDir) {
      setPhase({ name: 'error', message: `Lesson directory not found for "${lesson.slug}".` });
      return;
    }

    // Check if solution directory exists
    const solutionDir = path.join(lessonDir, 'solution');
    if (!fs.existsSync(solutionDir)) {
      setPhase({ name: 'done', lessonTitle: lesson.title, filesCopied: [], hasSolution: false });
      return;
    }

    // Copy solution files recursively into the project directory
    const copied: string[] = [];
    try {
      copyDirContents(solutionDir, projectDir, copied);
    } catch (err: any) {
      setPhase({ name: 'error', message: `Failed to copy solution: ${err.message}` });
      return;
    }

    setPhase({ name: 'done', lessonTitle: lesson.title, filesCopied: copied, hasSolution: true });
  };

  // ─── Phase renders ─────────────────────────────────────────────

  if (phase.name === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Loading lessons...</Text>
      </Box>
    );
  }

  if (phase.name === 'pick-lesson') {
    const { lessons, completedSlugs, currentSlug } = phase;
    const currentIndex = lessons.findIndex(l => l.slug === currentSlug);

    const items = lessons.map((lesson, _idx) => {
      const isCompleted = completedSlugs.has(lesson.slug);
      const isCurrent = lesson.slug === currentSlug;

      let label: string;
      if (isCompleted) {
        label = `✅ ${lesson.title}`;
      } else if (isCurrent) {
        label = `▶ ${lesson.title}`;
      } else {
        label = `  ${lesson.title}`;
      }

      return {
        label,
        value: lesson.slug,
        disabled: false,
      };
    });

    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="cyan">{'  '}📋 Select Lesson Solution to Copy</Text>
        <Box marginY={1} />
        <Text dimColor>{'  '}Copy solution code into your project. Use arrow keys, Enter to select:</Text>
        <Box marginY={1} />
        <Box marginLeft={2}>
          <SelectInput
            items={items}
            initialIndex={Math.max(0, currentIndex)}
            onSelect={(item) => {
              const lesson = lessons.find(l => l.slug === item.value);
              if (lesson) {
                doCopySolution(phase.config, lesson);
              }
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{'  '}✅ Completed  ▶ Current  — All lessons available</Text>
        </Box>
      </Box>
    );
  }

  if (phase.name === 'copying') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>{'  '}Copying solution for {phase.lessonTitle}...</Text>
      </Box>
    );
  }

  if (phase.name === 'done') {
    const { lessonTitle, filesCopied, hasSolution } = phase;

    if (!hasSolution) {
      return (
        <Box flexDirection="column" paddingX={2}>
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="yellow">{'  '}📘 Solution: {lessonTitle}</Text>
            <Box marginTop={1}>
              <Text color="yellow">{'  '}⚠ No solution available for this lesson.</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>{'  '}Solutions are added by the curriculum maintainer.</Text>
              <Text dimColor>{'  '}Check back later or implement the lesson yourself!</Text>
            </Box>
          </Box>
        </Box>
      );
    }

    const fileList = filesCopied.slice(0, 30);

    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="green">{'  '}📘 Solution Copied: {lessonTitle}</Text>
          <Box marginTop={1}>
            <Text color="green">{'  '}✓ {filesCopied.length} file(s) copied to your project</Text>
          </Box>
        </Box>

        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          <Text bold color="white">  Files Copied</Text>
          {fileList.map((f, i) => (
            <Text key={i} color="green">{'    '}✓ {f}</Text>
          ))}
          {filesCopied.length > 30 && (
            <Text dimColor>{'    '}... and {filesCopied.length - 30} more files</Text>
          )}
          <Box marginTop={1}>
            <Text dimColor>{'  '}Review the solution and compare with your implementation.</Text>
          </Box>
        </Box>
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

// ─── File Copy Utility ─────────────────────────────────────────────

/**
 * Recursively copy all files from source to destination.
 * Skips node_modules, .git, and hidden files.
 * Tracks which files were copied.
 */
function copyDirContents(src: string, dest: string, copied: string[]): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirContents(srcPath, destPath, copied);
    } else if (entry.isFile()) {
      // Ensure parent directory exists
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      // Check if file exists and warn about overwriting
      const relativePath = path.relative(dest, destPath);
      if (fs.existsSync(destPath)) {
        copied.push(`⚠ ${relativePath} (overwritten)`);
      } else {
        copied.push(relativePath);
      }

      fs.copyFileSync(srcPath, destPath);
    }
  }
}

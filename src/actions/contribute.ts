/**
 * ## Contribute Action
 *
 * Scaffolds new curriculum content (systems, tracks, modules, lessons)
 * and optionally creates a Pull Request to 100xsystems/curriculum.
 *
 * Commands:
 *   contribute init {system}       — Creates a new system directory with index.md
 *   contribute track {system} {lang} — Adds a new track to an existing system
 *   contribute lesson {system}     — Adds a new lesson scaffolder (interactive)
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { CURRICULUM_DIR, SYSTEMS_DIR } from '../reader/index.js';
import { systemExists, getSystemMeta } from '../reader/system-reader.js';
import { systemHasTracks, getSystemTracks } from '../reader/lesson-reader.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface SystemScaffold {
  slug: string;
  title: string;
  description: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  tags: string[];
  order: number;
  tracks: TrackScaffold[];
}

export interface TrackScaffold {
  slug: string;
  title: string;
  language: string;
  difficulty: string;
  modules: ModuleScaffold[];
}

export interface ModuleScaffold {
  title: string;
  slug?: string;
  lessons: LessonScaffold[];
}

export interface LessonScaffold {
  title: string;
  order: number;
  description: string;
  estimated_time: string;
  difficulty?: string;
  knowledge_refs: string[];
  content: string;
}

export interface ContributeResult {
  systemDir: string;
  filesCreated: string[];
  trackSlug?: string;
}

// ─── Slug Helpers ───────────────────────────────────────────────────

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function computeNextOrder(dir: string, prefix: string): number {
  try {
    if (!fs.existsSync(dir)) return 1;
    const items = fs.readdirSync(dir);
    let max = 0;
    for (const item of items) {
      const match = item.match(new RegExp(`^${prefix}(\\d+)`));
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    }
    return max + 1;
  } catch {
    return 1;
  }
}

// ─── Index.md Generator ─────────────────────────────────────────────

function generateSystemIndexMd(scaffold: SystemScaffold): string {
  const tracksYaml = scaffold.tracks.map((t) => {
    const modulesYaml = t.modules.map((m) => {
      const slug = m.slug || `module-${toSlug(m.title)}`;
      return `      - slug: ${slug}\n        title: "${m.title}"`;
    });

    return `  - slug: ${t.slug}\n    title: "${t.title}"\n    language: ${t.language}\n    difficulty: ${t.difficulty}\n    modules:\n${modulesYaml.join('\n')}`;
  });

  return `---
title: "${scaffold.title}"
description: "${scaffold.description}"
difficulty: ${scaffold.difficulty}
tags: [${scaffold.tags.map((t) => `"${t}"`).join(', ')}]
order: ${scaffold.order}
tracks:
${tracksYaml.join('\n')}
---

# ${scaffold.title}

${scaffold.description}

## Overview

<!-- Add system overview here -->

## Prerequisites

<!-- List prerequisite knowledge -->

## Learning Objectives

<!-- List what learners will achieve -->
`;
}

// ─── Lesson Frontmatter Generator ───────────────────────────────────

function generateLessonFrontmatter(lesson: LessonScaffold, moduleSlug: string, trackSlug: string): string {
  return `---
title: "${lesson.title}"
description: "${lesson.description}"
order: ${lesson.order}
difficulty: ${lesson.difficulty || 'Intermediate'}
estimated_time: "${lesson.estimated_time || '30 minutes'}"
knowledge_refs: [${lesson.knowledge_refs.map((r) => `"${r}"`).join(', ')}]
prerequisites: []
---

# ${lesson.title}

${lesson.description}

## Overview

<!-- Add lesson content here -->

## Key Concepts

<!-- List the key concepts covered in this lesson -->

## Implementation

<!-- Add implementation details here -->

## Exercises

<!-- Add exercises here -->

## Summary

<!-- Summarize what was learned -->
`;
}

// ─── Init System — Creates the full directory structure ───────────

export function initSystem(scaffold: SystemScaffold): ContributeResult {
  const systemsDir = SYSTEMS_DIR();
  const systemDir = path.join(systemsDir, scaffold.slug);
  const filesCreated: string[] = [];

  // Check for conflicts
  if (fs.existsSync(systemDir) && fs.readdirSync(systemDir).length > 0) {
    throw new Error(
      `System "${scaffold.slug}" already exists at ${systemDir}.\n` +
      `  Use \`100xsystems contribute track\` to add a language track, or\n` +
      `  Use \`100xsystems contribute lesson\` to add a lesson to an existing system.`
    );
  }

  // Create system directory
  fs.mkdirSync(systemDir, { recursive: true });

  // Write index.md
  const indexContent = generateSystemIndexMd(scaffold);
  fs.writeFileSync(path.join(systemDir, 'index.md'), indexContent);
  filesCreated.push(path.join(systemDir, 'index.md'));

  // Create tracks
  for (const track of scaffold.tracks) {
    const trackDir = path.join(systemDir, track.slug);
    fs.mkdirSync(trackDir, { recursive: true });
    filesCreated.push(trackDir + '/');

    for (const mod of track.modules) {
      const moduleSlug = mod.slug || `module-${toSlug(mod.title)}`;
      const moduleDir = path.join(trackDir, moduleSlug);
      fs.mkdirSync(moduleDir, { recursive: true });
      filesCreated.push(moduleDir + '/');

      for (const lesson of mod.lessons) {
        const lessonSlug = `${String(lesson.order).padStart(2, '0')}-lesson-${toSlug(lesson.title)}`;
        const lessonContent = generateLessonFrontmatter(lesson, moduleSlug, track.slug);
        const lessonPath = path.join(moduleDir, `${lessonSlug}.md`);
        fs.writeFileSync(lessonPath, lessonContent);
        filesCreated.push(lessonPath);
      }
    }
  }

  return { systemDir, filesCreated };
}

// ─── Add Track to Existing System ───────────────────────────────────

export function addTrack(
  systemSlug: string,
  trackTitle: string,
  language: string,
  difficulty: string,
): ContributeResult {
  if (!systemExists(systemSlug)) {
    throw new Error(`System "${systemSlug}" not found.`);
  }

  const systemsDir = SYSTEMS_DIR();
  const trackSlug = `track-${toSlug(language)}`;
  const trackDir = path.join(systemsDir, systemSlug, trackSlug);
  const filesCreated: string[] = [];

  if (fs.existsSync(trackDir)) {
    throw new Error(`Track "${trackSlug}" already exists for "${systemSlug}".`);
  }

  fs.mkdirSync(trackDir, { recursive: true });
  filesCreated.push(trackDir + '/');

  // Create a default module
  const moduleSlug = 'module-1-introduction';
  const moduleDir = path.join(trackDir, moduleSlug);
  fs.mkdirSync(moduleDir, { recursive: true });
  filesCreated.push(moduleDir + '/');

  // Create a default first lesson
  const lesson: LessonScaffold = {
    title: `Introduction to ${trackTitle}`,
    order: 1,
    description: `Get started with ${trackTitle} for ${systemSlug}.`,
    estimated_time: '30 minutes',
    knowledge_refs: [],
    content: '',
  };

  const lessonSlug = '01-lesson-introduction';
  const lessonContent = generateLessonFrontmatter(lesson, moduleSlug, trackSlug);
  const lessonPath = path.join(moduleDir, `${lessonSlug}.md`);
  fs.writeFileSync(lessonPath, lessonContent);
  filesCreated.push(lessonPath);

  // Update index.md tracks list
  const indexMdPath = path.join(systemsDir, systemSlug, 'index.md');
  if (fs.existsSync(indexMdPath)) {
    let indexContent = fs.readFileSync(indexMdPath, 'utf-8');
    // Add the new track to the frontmatter
    const trackEntry = `  - slug: ${trackSlug}\n    title: "${trackTitle}"\n    language: ${language}\n    difficulty: ${difficulty}\n    modules:\n      - slug: ${moduleSlug}\n        title: "Introduction"`;
    indexContent = indexContent.replace(
      /tracks:\n/,
      `tracks:\n${trackEntry}\n`,
    );
    fs.writeFileSync(indexMdPath, indexContent);
    filesCreated.push(indexMdPath + ' (updated)');
  }

  return { systemDir: trackDir, filesCreated, trackSlug };
}

// ─── Add Lesson to Existing Track ───────────────────────────────────

export function addLesson(
  systemSlug: string,
  trackSlug: string,
  moduleTitle: string,
  lesson: LessonScaffold,
): ContributeResult {
  if (!systemExists(systemSlug)) {
    throw new Error(`System "${systemSlug}" not found.`);
  }

  const systemsDir = SYSTEMS_DIR();
  const trackDir = path.join(systemsDir, systemSlug, trackSlug);

  if (!fs.existsSync(trackDir)) {
    throw new Error(`Track "${trackSlug}" not found for system "${systemSlug}".`);
  }

  const filesCreated: string[] = [];
  const moduleSlug = `module-${computeNextOrder(trackDir, 'module-')}-${toSlug(moduleTitle)}`;
  const moduleDir = path.join(trackDir, moduleSlug);

  fs.mkdirSync(moduleDir, { recursive: true });
  filesCreated.push(moduleDir + '/');

  const lessonSlug = `${String(lesson.order).padStart(2, '0')}-lesson-${toSlug(lesson.title)}`;
  const lessonContent = generateLessonFrontmatter(lesson, moduleSlug, trackSlug);
  const lessonPath = path.join(moduleDir, `${lessonSlug}.md`);
  fs.writeFileSync(lessonPath, lessonContent);
  filesCreated.push(lessonPath);

  return { systemDir: moduleDir, filesCreated };
}

// ─── Verify Curriculum Access ───────────────────────────────────────

export function verifyCurriculumAccess(): string {
  const curriculumDir = CURRICULUM_DIR();
  if (!fs.existsSync(curriculumDir)) {
    throw new Error(
      `Curriculum directory not found at "${curriculumDir}".\n` +
      `  This command must be run from within the 100xsystems monorepo.\n` +
      `  Clone the repository first:\n` +
      `    git clone https://github.com/100xsystems/100xsystems.git\n` +
      `    cd 100xsystems`
    );
  }
  return curriculumDir;
}

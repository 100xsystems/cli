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

// ─── Lesson Frontmatter + Test Generator ──────────────────────────

/**
 * Generate a lesson's lesson.md with proper frontmatter and content.
 * Creates flat-format lessons (no module field).
 */
function generateLessonFrontmatter(lesson: LessonScaffold): string {
  return `---
title: "${lesson.title}"
description: "${lesson.description}"
order: ${lesson.order}
difficulty: ${lesson.difficulty || 'Intermediate'}
estimated_time: "${lesson.estimated_time || '30 minutes'}"
knowledge_refs: [${lesson.knowledge_refs.map((r) => `"${r}"`).join(', ')}]
prerequisites: []
validation:
  - type: test-runner
    test_file: "tests/behavior.test.ts"
    framework: vitest
    timeout: 120000
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

/**
 * Generate a boilerplate behavior.test.ts file for a new lesson.
 * Pre-populated with imports from @100xsystems/test-suite-typescript.
 */
function generateLessonTestFile(lesson: LessonScaffold): string {
  const testName = lesson.title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const testDescription = `should have required project files for ${testName.toLowerCase()}`;

  return `import { describe, it, expect, fileExists, readJson, expectBuildSucceeds } from '@100xsystems/test-suite-typescript';

describe('${testName}', () => {
  it('${testDescription}', () => {
    expect(fileExists('package.json')).toBe(true);
    expect(fileExists('tsconfig.json')).toBe(true);
  });

  it('has valid package.json with build script', () => {
    const pkg = readJson('package.json');
    expect(pkg.scripts?.build).toBeDefined();
  });

  it('builds successfully', () => {
    expectBuildSucceeds();
  });
});
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
    filesCreated.push(trackDir + '/');      for (const lesson of track.modules.flatMap(m => m.lessons)) {
        const lessonFolderName = `lesson-${toSlug(lesson.title)}`;
        const lessonDir = path.join(trackDir, lessonFolderName);
        fs.mkdirSync(lessonDir, { recursive: true });
        filesCreated.push(lessonDir + '/');

        // Create tests/ subdirectory
        const testsDir = path.join(lessonDir, 'tests');
        fs.mkdirSync(testsDir, { recursive: true });
        filesCreated.push(testsDir + '/');

        // Write lesson.md
        const lessonContent = generateLessonFrontmatter(lesson);
        const lessonPath = path.join(lessonDir, 'lesson.md');
        fs.writeFileSync(lessonPath, lessonContent);
        filesCreated.push(lessonPath);

        // Write tests/behavior.test.ts
        const testContent = generateLessonTestFile(lesson);
        const testPath = path.join(testsDir, 'behavior.test.ts');
        fs.writeFileSync(testPath, testContent);
        filesCreated.push(testPath);
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

  // Create a default first lesson directly under track root (flat structure)
  const lesson: LessonScaffold = {
    title: `Introduction to ${trackTitle}`,
    order: 1,
    description: `Get started with ${trackTitle} for ${systemSlug}.`,
    estimated_time: '30 minutes',
    knowledge_refs: [],
    content: '',
  };

  const lessonFolderName = 'lesson-introduction';
  const lessonDir = path.join(trackDir, lessonFolderName);
  fs.mkdirSync(lessonDir, { recursive: true });
  filesCreated.push(lessonDir + '/');

  // Create tests/ subdirectory
  const testsDir = path.join(lessonDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  filesCreated.push(testsDir + '/');

  const lessonContent = generateLessonFrontmatter(lesson);
  const lessonPath = path.join(lessonDir, 'lesson.md');
  fs.writeFileSync(lessonPath, lessonContent);
  filesCreated.push(lessonPath);

  const testContent = generateLessonTestFile(lesson);
  const testPath = path.join(testsDir, 'behavior.test.ts');
  fs.writeFileSync(testPath, testContent);
  filesCreated.push(testPath);

  // Update index.md tracks list (no modules field anymore)
  const indexMdPath = path.join(systemsDir, systemSlug, 'index.md');
  if (fs.existsSync(indexMdPath)) {
    let indexContent = fs.readFileSync(indexMdPath, 'utf-8');
    const trackEntry = `  - slug: ${trackSlug}\n    title: "${trackTitle}"\n    language: ${language}\n    difficulty: ${difficulty}`;
    indexContent = indexContent.replace(
      /tracks:\n/,
      `tracks:\n${trackEntry}\n`,
    );
    fs.writeFileSync(indexMdPath, indexContent);
    filesCreated.push(indexMdPath + ' (updated)');
  }

  return { systemDir: trackDir, filesCreated, trackSlug };
}

// ─── Add Lesson to Existing Track — Folder-based with tests/ ────────

export function addLesson(
  systemSlug: string,
  trackSlug: string,
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

  // Create flat lesson structure directly under track root (no modules)
  const lessonFolderName = `lesson-${toSlug(lesson.title)}`;
  const lessonDir = path.join(trackDir, lessonFolderName);
  fs.mkdirSync(lessonDir, { recursive: true });
  filesCreated.push(lessonDir + '/');

  // Create tests/ subdirectory
  const testsDir = path.join(lessonDir, 'tests');
  fs.mkdirSync(testsDir, { recursive: true });
  filesCreated.push(testsDir + '/');

  // Write lesson.md
  const lessonContent = generateLessonFrontmatter(lesson);
  const lessonPath = path.join(lessonDir, 'lesson.md');
  fs.writeFileSync(lessonPath, lessonContent);
  filesCreated.push(lessonPath);

  // Write tests/behavior.test.ts (boilerplate from shared package)
  const testContent = generateLessonTestFile(lesson);
  const testPath = path.join(testsDir, 'behavior.test.ts');
  fs.writeFileSync(testPath, testContent);
  filesCreated.push(testPath);

  return { systemDir: lessonDir, filesCreated };
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

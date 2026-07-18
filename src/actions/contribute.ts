/**
 * ## Contribute Action
 *
 * Scaffolds new curriculum content (systems, tracks, lessons)
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
  lesson_type?: string;
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

/**
 * Compute the next available lesson number in a track directory
 * by scanning existing NN-prefixed folders.
 */
function nextLessonNumber(trackDir: string): number {
  if (!fs.existsSync(trackDir)) return 1;
  try {
    const entries = fs.readdirSync(trackDir, { withFileTypes: true });
    let maxNum = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return maxNum + 1;
  } catch {
    return 1;
  }
}

/**
 * Generate a track index.md with ordered lesson listing.
 */
function generateTrackIndexMd(lessons: Array<{ slug: string; title: string; lesson_type: string }>): string {
  const lessonsYaml = lessons.map((l) =>
    `  - slug: "${l.slug}"\n    title: "${l.title}"\n    lesson_type: "${l.lesson_type || 'lesson'}"`
  );
  return `---\nlessons:\n${lessonsYaml.join('\n')}\n---\n`;
}

// ─── Index.md Generator ─────────────────────────────────────────────

function generateSystemIndexMd(scaffold: SystemScaffold): string {
  const tracksYaml = scaffold.tracks.map((t) => {
    return `  - slug: ${t.slug}\n    title: "${t.title}"\n    language: ${t.language}\n    difficulty: ${t.difficulty}`;
  });

  return `---\ntitle: "${scaffold.title}"\ndescription: "${scaffold.description}"\ndifficulty: ${scaffold.difficulty}\ntags: [${scaffold.tags.map((t) => `"${t}"`).join(', ')}]\norder: ${scaffold.order}\ntracks:\n${tracksYaml.join('\n')}\n---\n\n# ${scaffold.title}\n\n${scaffold.description}\n\n## Overview\n\n<!-- Add system overview here -->\n\n## Prerequisites\n\n<!-- List prerequisite knowledge -->\n\n## Learning Objectives\n\n<!-- List what learners will achieve -->\n`;
}

// ─── Lesson Frontmatter + Test Generator ──────────────────────────

/**
 * Generate a lesson's lesson.md with proper frontmatter and content.
 * Includes lesson_type for the user_progress DB.
 */
function generateLessonFrontmatter(lesson: LessonScaffold): string {
  return `---\ntitle: "${lesson.title}"\ndescription: "${lesson.description}"\norder: ${lesson.order}\nlesson_type: "${lesson.lesson_type || 'lesson'}"\ndifficulty: ${lesson.difficulty || 'Intermediate'}\nestimated_time: "${lesson.estimated_time || '30 minutes'}"\nknowledge_refs: [${lesson.knowledge_refs.map((r) => `"${r}"`).join(', ')}]\nprerequisites: []\nvalidation:\n  - type: test-runner\n    test_file: "tests/behavior.test.ts"\n    framework: vitest\n    timeout: 120000\n---\n\n# ${lesson.title}\n\n${lesson.description}\n\n## Overview\n\n<!-- Add lesson content here -->\n\n## Key Concepts\n\n<!-- List the key concepts covered in this lesson -->\n\n## Implementation\n\n<!-- Add implementation details here -->\n\n## Exercises\n\n<!-- Add exercises here -->\n\n## Summary\n\n<!-- Summarize what was learned -->\n`;
}

/**
 * Generate a boilerplate behavior.test.ts file for a new lesson.
 * Pre-populated with imports from @100xsystems/test-suite-typescript.
 */
function generateLessonTestFile(lesson: LessonScaffold): string {
  const testName = lesson.title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const testDescription = `should have required project files for ${testName.toLowerCase()}`;

  return `import { describe, it, expect, fileExists, readJson, expectBuildSucceeds } from '@100xsystems/test-suite-typescript';\n\ndescribe('${testName}', () => {\n  it('${testDescription}', () => {\n    expect(fileExists('package.json')).toBe(true);\n    expect(fileExists('tsconfig.json')).toBe(true);\n  });\n\n  it('has valid package.json with build script', () => {\n    const pkg = readJson('package.json');\n    expect(pkg.scripts?.build).toBeDefined();\n  });\n\n  it('builds successfully', () => {\n    expectBuildSucceeds();\n  });\n});\n`;
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

  // Write system index.md
  const indexContent = generateSystemIndexMd(scaffold);
  fs.writeFileSync(path.join(systemDir, 'index.md'), indexContent);
  filesCreated.push(path.join(systemDir, 'index.md'));

  // Create tracks
  for (const track of scaffold.tracks) {
    const trackDir = path.join(systemDir, track.slug);
    fs.mkdirSync(trackDir, { recursive: true });
    filesCreated.push(trackDir + '/');

    const lessonsInTrack: Array<{ slug: string; title: string; lesson_type: string }> = [];

    for (const lesson of track.modules.flatMap(m => m.lessons)) {
      const num = nextLessonNumber(trackDir);
      const slugBase = `lesson-${toSlug(lesson.title)}`;
      const lessonFolderName = `${String(num).padStart(2, '0')}-${slugBase}`;
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

      lessonsInTrack.push({ slug: slugBase, title: lesson.title, lesson_type: lesson.lesson_type || 'lesson' });
    }

    // Write track index.md
    const trackIndexContent = generateTrackIndexMd(lessonsInTrack);
    fs.writeFileSync(path.join(trackDir, 'index.md'), trackIndexContent);
    filesCreated.push(path.join(trackDir, 'index.md'));
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

  // Create a default first lesson with NN- prefix
  const lesson: LessonScaffold = {
    title: `Introduction to ${trackTitle}`,
    order: 1,
    description: `Get started with ${trackTitle} for ${systemSlug}.`,
    estimated_time: '30 minutes',
    lesson_type: 'lesson',
    knowledge_refs: [],
    content: '',
  };

  const num = nextLessonNumber(trackDir);
  const lessonFolderName = `${String(num).padStart(2, '0')}-lesson-introduction`;
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

  // Write track index.md
  const trackIndexContent = generateTrackIndexMd([
    { slug: 'lesson-introduction', title: lesson.title, lesson_type: 'lesson' },
  ]);
  fs.writeFileSync(path.join(trackDir, 'index.md'), trackIndexContent);
  filesCreated.push(path.join(trackDir, 'index.md'));

  // Update system index.md tracks list
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

// ─── Add Lesson to Existing Track — Numbered folder with tests/ ─────

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

  // Create numbered lesson folder
  const num = nextLessonNumber(trackDir);
  const slugBase = `lesson-${toSlug(lesson.title)}`;
  const lessonFolderName = `${String(num).padStart(2, '0')}-${slugBase}`;
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

  // Update track index.md with new lesson entry
  const trackIndexPath = path.join(trackDir, 'index.md');
  if (fs.existsSync(trackIndexPath)) {
    const lessonEntry = `  - slug: "${slugBase}"\n    title: "${lesson.title}"\n    lesson_type: "${lesson.lesson_type || 'lesson'}"`;
    let indexContent = fs.readFileSync(trackIndexPath, 'utf-8');
    indexContent = indexContent.replace(
      /lessons:\n/,
      `lessons:\n${lessonEntry}\n`,
    );
    fs.writeFileSync(trackIndexPath, indexContent);
    filesCreated.push(trackIndexPath + ' (updated)');
  }

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

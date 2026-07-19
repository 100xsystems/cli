/**
 * ## Audit Solutions Action
 *
 * Scans test files in a system's track and generates a `.solution-manifest.json`
 * documenting what each lesson's test expects. This manifest is used by
 * `verify-solutions` to detect drift between test files and solution files.
 *
 * Based on Exercism's `configlet sync` + `tests.toml` pattern:
 * - Instead of canonical-data.json + UUIDs, we auto-generate a manifest from
 *   each lesson's `tests/behavior.test.ts`
 * - The manifest records file expectations (fileExists, dirExists, fileMatches),
 *   build requirements (expectBuildSucceeds), and module imports (importModule)
 * - CI compares the committed manifest against current solution files
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { SYSTEMS_DIR, fileToSlug, slugToDisplayName } from '../reader/index.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface ExpectedFile {
  path: string;
  checks: string[];
}

export interface LessonExpectation {
  slug: string;
  title: string;
  order: number;
  testFile: string;
  expectedFiles: ExpectedFile[];
  expectedTests: number;
  hasBuildCheck: boolean;
  hasSolution: boolean;
}

export interface FileOwnership {
  currentOwner: string;
  previousOwners: string[];
}

export interface SolutionManifest {
  version: 2;
  generatedAt: string;
  system: string;
  track: string;
  lessons: Record<string, LessonExpectation>;
  files: Record<string, FileOwnership>;
}

// ─── Manifest Generator ─────────────────────────────────────────────

/**
 * Generate a solution manifest for a given system and track.
 * Scans all lessons, parses their test files, and records expectations.
 */
export function generateManifest(systemSlug: string, trackSlug: string): SolutionManifest {
  const trackDir = path.join(SYSTEMS_DIR(), systemSlug, trackSlug);
  const lessons: Record<string, LessonExpectation> = {};
  const fileOwnership: Record<string, FileOwnership> = {};

  if (!fs.existsSync(trackDir)) {
    return {
      version: 2,
      generatedAt: new Date().toISOString(),
      system: systemSlug,
      track: trackSlug,
      lessons: {},
      files: {},
    };
  }

  // Walk lessons in order
  const entries = fs.readdirSync(trackDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  let order = 0;
  for (const entry of entries) {
    order++;
    const lessonSlug = fileToSlug(entry.name);
    const lessonDir = path.join(trackDir, entry.name);
    const testFile = path.join(lessonDir, 'tests', 'behavior.test.ts');
    const solutionDir = path.join(lessonDir, 'solution');

    if (!fs.existsSync(testFile) && !fs.existsSync(solutionDir)) continue;

    // Parse lesson meta from lesson.md frontmatter
    const lessonMdPath = path.join(lessonDir, 'lesson.md');
    let lessonTitle = slugToDisplayName(lessonSlug);
    if (fs.existsSync(lessonMdPath)) {
      try {
        const raw = fs.readFileSync(lessonMdPath, 'utf-8');
        const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
        if (fmMatch) {
          const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
          if (titleMatch) lessonTitle = titleMatch[1].replace(/["']/g, '');
        }
      } catch { }
    }

    // Parse test expectations
    const expectedFiles: ExpectedFile[] = [];
    let expectedTests = 0;
    let hasBuildCheck = false;

    if (fs.existsSync(testFile)) {
      const content = fs.readFileSync(testFile, 'utf-8');
      parseTestExpectations(content, expectedFiles);
      expectedTests = countTestCases(content);
      hasBuildCheck = /expectBuildSucceeds/.test(content);
    }

    const hasSolution = fs.existsSync(solutionDir);

    const lesson: LessonExpectation = {
      slug: lessonSlug,
      title: lessonTitle,
      order,
      testFile: fs.existsSync(testFile) ? 'tests/behavior.test.ts' : '',
      expectedFiles,
      expectedTests,
      hasBuildCheck,
      hasSolution,
    };

    lessons[lessonSlug] = lesson;

    // Track file ownership (which solutions provide which files)
    if (hasSolution) {
      const solutionFiles = collectRelativeFiles(solutionDir);
      for (const relPath of solutionFiles) {
        const existing = fileOwnership[relPath];
        if (existing) {
          existing.previousOwners.push(existing.currentOwner);
          existing.currentOwner = lessonSlug;
        } else {
          fileOwnership[relPath] = {
            currentOwner: lessonSlug,
            previousOwners: [],
          };
        }
      }
    }

    // Track expected files that come from test expectations too
    for (const ef of expectedFiles) {
      if (!fileOwnership[ef.path]) {
        fileOwnership[ef.path] = {
          currentOwner: lessonSlug,
          previousOwners: [],
        };
      }
    }
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    system: systemSlug,
    track: trackSlug,
    lessons,
    files: fileOwnership,
  };
}

/**
 * Write the manifest to the track root.
 */
export function writeManifest(systemSlug: string, trackSlug: string, manifest: SolutionManifest): string {
  const outputDir = path.join(SYSTEMS_DIR(), systemSlug, trackSlug);
  const outputPath = path.join(outputDir, '.solution-manifest.json');
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
  return outputPath;
}

/**
 * Read the manifest from the track root.
 */
export function readManifest(systemSlug: string, trackSlug: string): SolutionManifest | null {
  const manifestPath = path.join(SYSTEMS_DIR(), systemSlug, trackSlug, '.solution-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Compare the generated manifest against the committed one.
 * Returns a list of differences (lessons added, removed, changed).
 */
export function diffManifests(
  generated: SolutionManifest,
  committed: SolutionManifest | null,
): ManifestDiff {
  const diff: ManifestDiff = { added: [], removed: [], changed: [] };

  if (!committed) {
    diff.added = Object.keys(generated.lessons);
    return diff;
  }

  const generatedSlugs = new Set(Object.keys(generated.lessons));
  const committedSlugs = new Set(Object.keys(committed.lessons));

  for (const slug of generatedSlugs) {
    if (!committedSlugs.has(slug)) {
      diff.added.push(slug);
    } else {
      const g = generated.lessons[slug];
      const c = committed.lessons[slug];
      if (JSON.stringify(g.expectedFiles) !== JSON.stringify(c.expectedFiles) ||
          g.expectedTests !== c.expectedTests ||
          g.hasBuildCheck !== c.hasBuildCheck ||
          g.hasSolution !== c.hasSolution) {
        diff.changed.push(slug);
      }
    }
  }

  for (const slug of committedSlugs) {
    if (!generatedSlugs.has(slug)) {
      diff.removed.push(slug);
    }
  }

  return diff;
}

export interface ManifestDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

// ─── Test Parser ────────────────────────────────────────────────────

/**
 * Parse test file content and extract file expectations.
 * Handles: fileExists, dirExists, fileMatches, fileContains, importModule.
 */
function parseTestExpectations(content: string, results: ExpectedFile[]): void {
  // fileExists('path')
  const fileExistsRegex = /fileExists\(['"]([^'"]+)['"]\)/g;
  let match: RegExpExecArray | null;
  while ((match = fileExistsRegex.exec(content)) !== null) {
    addExpectation(results, match[1], 'exists');
  }

  // dirExists('path')
  const dirExistsRegex = /dirExists\(['"]([^'"]+)['"]\)/g;
  while ((match = dirExistsRegex.exec(content)) !== null) {
    addExpectation(results, match[1], 'dirExists');
  }

  // fileMatches('path', /pattern/flags)
  const fileMatchesRegex = /fileMatches\(['"]([^'"]+)['"],\s*\/([^/]+)\/(\w*)\)/g;
  while ((match = fileMatchesRegex.exec(content)) !== null) {
    addExpectation(results, match[1], `matches:/${match[2]}/${match[3]}`);
  }

  // fileContains('path', 'text')
  const fileContainsRegex = /fileContains\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/g;
  while ((match = fileContainsRegex.exec(content)) !== null) {
    addExpectation(results, match[1], `contains:${match[2]}`);
  }

  // importModule('path')
  const importModuleRegex = /importModule\(['"]([^'"]+)['"]\)/g;
  while ((match = importModuleRegex.exec(content)) !== null) {
    addExpectation(results, `dist/${match[1]}`, 'importable');
  }

  // fileCount('path', min)
  const fileCountRegex = /fileCount\(['"]([^'"]+)['"],\s*(\d+)\)/g;
  while ((match = fileCountRegex.exec(content)) !== null) {
    addExpectation(results, match[1], `minCount:${match[2]}`);
  }
}

function addExpectation(results: ExpectedFile[], filePath: string, check: string): void {
  const existing = results.find(r => r.path === filePath);
  if (existing) {
    if (!existing.checks.includes(check)) {
      existing.checks.push(check);
    }
  } else {
    results.push({ path: filePath, checks: [check] });
  }
}

/**
 * Count test cases in a test file.
 */
function countTestCases(content: string): number {
  const regex = /\b(?:it|test)\s*\(\s*(?:`[^`]*`|'[^']*'|"[^"]*"|[^,)]+)/g;
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Collect all relative file paths from a directory recursively.
 */
function collectRelativeFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string, relative: string) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        files.push(relPath);
      }
    }
  }

  walk(dir, '');
  return files;
}

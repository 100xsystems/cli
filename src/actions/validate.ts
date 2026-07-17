/**
 * ## Validate Action
 *
 * Runs validation checks against a user's project.
 * Integrates with the executor plugin system for lesson-specific validation.
 *
 * Features:
 * - 3-level validation: L1 structure, L2 behavioral tests, L3 spec checks
 * - Frontmatter schema validation (catches common YAML mistakes before tests run)
 * - Auto-detected expected_passes from test files
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { readProjectConfig, PROJECT_CONFIG } from '../scaffold/index.js';
import { runLessonValidators } from '../executors/index.js';
import type { ExecutorResult } from '../executors/index.js';
import { SYSTEMS_DIR, fetchRegistry, syncSystemFromRegistry, parseFrontmatter } from '../reader/index.js';
import type { SpecCheck } from '../reader/index.js';
import { getSpec } from '../reader/spec-reader.js';

// ─── Exported Types ─────────────────────────────────────────────────

export type ValidationLevel = 1 | 2 | 3;

export interface ValidationResult {
  check: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  category: 'documentation' | 'structure' | 'code' | 'git' | 'validation' | 'test' | 'build' | 'lesson' | 'spec';
  details?: string;
  /** Which validation level produced this result:
   * Level 1 = Project structure basics (config, README, package.json)
   * Level 2 = Lesson-defined validators from frontmatter
   * Level 3 = Spec-defined checks from SPECIFICATION.md
   */
  level?: ValidationLevel;
}

export interface ValidationSummary {
  results: ValidationResult[];
  byLevel: {
    1: { pass: number; warn: number; fail: number; items: ValidationResult[] };
    2: { pass: number; warn: number; fail: number; items: ValidationResult[] };
    3: { pass: number; warn: number; fail: number; items: ValidationResult[] };
  };
  total: { pass: number; warn: number; fail: number };
  lessonSlug: string;
  lessonTitle: string;
  systemSlug: string;
  trackSlug: string;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Run validation checks and return results.
 * Three-level validation architecture:
 *   Level 1: Project structure — config, README, package.json, src/
 *   Level 2: Lesson-defined validators from frontmatter (executor-based)
 *   Level 3: Spec-defined checks from SPECIFICATION.md
 *
 * @param projectDir - Absolute path to the project
 * @param config - Project config from 100xsystems.json
 * @param lessonSlug - Optional: only run validators for this specific lesson.
 *                     If not provided, uses currentLesson from progress tracking.
 * @returns Flat array of ValidationResult sorted by severity (fail→warn→pass), each tagged with level
 */
export async function runValidation(
  projectDir: string,
  config: Record<string, any>,
  lessonSlug?: string,
): Promise<ValidationResult[]> {
  if (!config) {
    throw new Error('Config is required to run validation. Run `100x init <system>` first.');
  }

  const results: ValidationResult[] = [];
  const systemSlug = (config.system as string) || '';
  const trackSlug = (config.track as string) || '';

  // Determine which lesson to validate
  let targetLesson = lessonSlug;
  if (!targetLesson && systemSlug) {
    const configProgress = config.progress || {};
    targetLesson = configProgress.currentLesson || '';
  }

  // ── LEVEL 1: Project Structure  ──────────────────────────────────
  // These are the foundational checks that every project must pass.
  // They verify the project was properly initialized and has the basic
  // structure expected by the curriculum.
  results.push(...checkLevel1(projectDir, systemSlug, trackSlug));

  // ── LEVEL 1.5: Frontmatter Schema Validation  ────────────────────
  // Validate all lesson frontmatter blocks for common YAML mistakes
  // before attempting to run level 2 validators. This catches typos,
  // missing keys, and structural issues early.
  if (systemSlug) {
    try {
      const fmResults = validateLessonFrontmatter(systemSlug, trackSlug, targetLesson);
      results.push(...fmResults);
    } catch (err: any) {
      results.push({
        check: 'frontmatter-validation',
        status: 'warn',
        message: `Frontmatter validation error: ${err.message}`,
        category: 'lesson',
        details: err.stack,
        level: 1,
      });
    }
  }

  // ── LEVEL 2: Lesson Validators  ───────────────────────────────────
  // These come from the `validation:` block in each lesson's frontmatter.
  // Each lesson defines what it validates — file existence, content,
  // tests, HTTP endpoints, Dockerfiles, etc.
  // Only runs validators for the target lesson (or all if no lesson specified).
  if (systemSlug) {
    try {
      const lessonResults = await runLessonValidatorsFromCurriculum(
        projectDir, systemSlug, trackSlug, targetLesson
      );
      results.push(...lessonResults);
    } catch (err: any) {
      results.push({
        check: 'executors',
        status: 'warn',
        message: `Level 2 validator error: ${err.message}`,
        category: 'lesson',
        details: err.stack,
        level: 2,
      });
    }

    // ── LEVEL 3: Spec-Defined Checks  ────────────────────────────────
    // These come from SPECIFICATION.md in the curriculum and verify
    // that the implementation meets the system specification.
    try {
      const specResults = await runSpecChecksFromCurriculum(projectDir, systemSlug);
      results.push(...specResults);
    } catch {
      // Spec checks are optional — skip gracefully if no spec exists
    }
  }

  // Sort: failures first, then warnings, then passes
  results.sort((a, b) => {
    const order: Record<string, number> = { fail: 0, warn: 1, pass: 2 };
    return (order[a.status] ?? 0) - (order[b.status] ?? 0);
  });

  return results;
}

/**
 * Run all 3 validation levels and return a structured summary.
 * This is the preferred entry point for the validate command and submit flow.
 */
export async function runValidationWithSummary(
  projectDir: string,
  config: Record<string, any>,
  lessonSlug?: string,
  lessonTitle?: string,
): Promise<ValidationSummary> {
  const results = await runValidation(projectDir, config, lessonSlug);

  const byLevel = {
    1: { pass: 0, warn: 0, fail: 0, items: [] as ValidationResult[] },
    2: { pass: 0, warn: 0, fail: 0, items: [] as ValidationResult[] },
    3: { pass: 0, warn: 0, fail: 0, items: [] as ValidationResult[] },
  };
  const total = { pass: 0, warn: 0, fail: 0 };

  for (const r of results) {
    const level = (r.level || 1) as 1 | 2 | 3;
    const group = byLevel[level];
    group.items.push(r);
    if (r.status === 'pass') { group.pass++; total.pass++; }
    else if (r.status === 'warn') { group.warn++; total.warn++; }
    else if (r.status === 'fail') { group.fail++; total.fail++; }
  }

  const systemSlug = (config.system as string) || '';
  const trackSlug = (config.track as string) || '';

  return {
    results,
    byLevel,
    total,
    lessonSlug: lessonSlug || config.progress?.currentLesson || '',
    lessonTitle: lessonTitle || '',
    systemSlug,
    trackSlug,
  };
}

// ─── Lesson Validator Integration ───────────────────────────────────

/**
 * Execute validators for a specific lesson in the system's curriculum.
 * Uses the track slug from 100xsystems.json to find the track directory.
 * Only runs validators from that single lesson — not all lessons.
 */
async function runLessonValidatorsFromCurriculum(
  projectDir: string,
  systemSlug: string,
  trackSlug: string,
  lessonSlug?: string
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  // Resolve the system's curriculum directory:
  //   1. Cache: ~/.cache/100xsystems/repos/<slug>/  (from registry sync)
  //   2. Monorepo: <project>/curriculum/systems/<slug>/  (legacy dev)
  //   3. Registry sync: fetch registry.json and shallow-clone the repo
  const systemDir = await resolveSystemCurriculumDir(systemSlug);
  if (!systemDir) return results;

  // Find the track directory by slug
  const trackDir = path.join(systemDir, trackSlug);
  if (!fs.existsSync(trackDir)) return results;

  // Find all lessons with validators and locate the target
  const lessonsWithValidators = findLessonsWithValidators(trackDir);

  // If a specific lesson slug is given, only run that lesson's validators
  const targetLesson = lessonSlug
    ? lessonsWithValidators.find(l => l.slug === lessonSlug)
    : null;

  const lessonsToRun = targetLesson ? [targetLesson] : [];

  if (lessonsToRun.length === 0 && lessonSlug) {
    // Lesson slug specified but no validators found for it — try finding by filename
    const allLessons = findAllLessonFiles(trackDir);
    const matchingLesson = allLessons.find(l => l.slug === lessonSlug);
    if (matchingLesson) {
      results.push({
        check: 'lesson-lookup',
        status: 'warn',
        message: `Lesson "${lessonSlug}" found but has no validators defined in its frontmatter.`,
        category: 'lesson',
      });
    } else {
      results.push({
        check: 'lesson-lookup',
        status: 'warn',
        message: `Lesson "${lessonSlug}" not found in track ${trackSlug}.`,
        category: 'lesson',
      });
    }
  }

  // Run validators for the target lesson(s)
  for (const lesson of lessonsToRun) {
    const ctx = {
      projectDir,
      lessonDir: lesson.dir,
      workspace: systemSlug,
    };

    const executorResults = await runLessonValidators(lesson.validators, ctx);

    for (const er of executorResults) {
      results.push({
        check: er.check,
        status: er.status as 'pass' | 'warn' | 'fail',
        message: er.message,
        category: er.category as any,
        details: er.details,
        level: 2,
      });
    }
  }

  return results;
}

/**
 * Resolve the system's curriculum directory from multiple sources.
 *
 * Priority:
 *   1. SYSTEMS_DIR() + slug — cache (~/.cache/100xsystems/repos/<slug>/) or monorepo
 *   2. Registry sync — fetch registry.json, find the repo URL, shallow-clone to cache
 *
 * Returns the absolute path to the system's curriculum root, or null if not found.
 */
async function resolveSystemCurriculumDir(systemSlug: string): Promise<string | null> {
  // 1. Check SYSTEMS_DIR() — handles cache + monorepo resolution
  const fromSystems = path.join(SYSTEMS_DIR(), systemSlug);
  if (fs.existsSync(fromSystems) && fs.existsSync(path.join(fromSystems, 'index.md'))) {
    return fromSystems;
  }

  // 2. Try syncing from registry
  try {
    const registry = await fetchRegistry();
    const systemEntry = registry.systems?.find((s: any) => s.slug === systemSlug);
    if (systemEntry && systemEntry.repo) {
      await syncSystemFromRegistry(systemSlug, systemEntry.repo);
      const cached = path.join(SYSTEMS_DIR(), systemSlug);
      if (fs.existsSync(cached)) {
        return cached;
      }
    }
  } catch {
    // Registry unavailable — continue with local-only results
  }

  return null;
}

// ─── Frontmatter Schema Validation ─────────────────────────────────

/**
 * REQUIRED frontmatter keys that every lesson must have.
 * Used by validateLessonFrontmatter to catch missing fields early.
 */
const REQUIRED_LESSON_KEYS = ['title', 'description'];

/**
 * KNOWN validator types in the executor registry.
 * Used to catch typos in validation block type fields.
 */
const KNOWN_VALIDATOR_TYPES = [
  'file-exists', 'file-contains', 'cli-command', 'npm-test',
  'http', 'regex', 'docker', 'test-runner',
];

/**
 * Validate frontmatter schema for all lessons in the target track.
 * Checks for:
 *   1. Missing required keys (title, description)
 *   2. Invalid validation block types (typos)
 *   3. Malformed YAML that the custom parser might silently misinterpret
 *
 * Returns pass/warn results without blocking execution.
 */
function validateLessonFrontmatter(
  systemSlug: string,
  trackSlug: string,
  lessonSlug?: string
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const systemDir = path.join(SYSTEMS_DIR(), systemSlug);
  if (!fs.existsSync(systemDir)) return results;

  const trackDir = path.join(systemDir, trackSlug);
  if (!fs.existsSync(trackDir)) return results;

  // Walk lessons and validate each one
  const lessons = findAllLessonFiles(trackDir);

  // If targeting a specific lesson, only validate that one
  const targetLessons = lessonSlug
    ? lessons.filter(l => l.slug === lessonSlug)
    : lessons;

  if (targetLessons.length === 0) return results;

  for (const lesson of targetLessons) {
    try {
      const lessonMdPath = path.join(lesson.dir, 'lesson.md');
      if (!fs.existsSync(lessonMdPath)) continue;

      const content = fs.readFileSync(lessonMdPath, 'utf-8');
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

      if (!frontmatterMatch) {
        results.push({
          check: `frontmatter:${lesson.slug}`,
          status: 'warn',
          message: `Lesson "${lesson.slug}" has no frontmatter block. Add \`---\` delimiters at the top.`,
          category: 'lesson',
          level: 1,
        });
        continue;
      }

      const yamlBlock = frontmatterMatch[1];

      // Check for missing closing delimiter (common mistake)
      const delimiterCount = (content.match(/^---\s*$/gm) || []).length;
      if (delimiterCount < 2) {
        results.push({
          check: `frontmatter:${lesson.slug}`,
          status: 'fail',
          message: `Lesson "${lesson.slug}" has unclosed frontmatter. Ensure both \`---\` delimiters are present.`,
          category: 'lesson',
          level: 1,
        });
        continue;
      }

      // Parse the YAML block
      const parsed = parseFrontmatter(content);
      const data = parsed.data;

      // Check required keys
      for (const key of REQUIRED_LESSON_KEYS) {
        if (!data[key]) {
          results.push({
            check: `frontmatter:${lesson.slug}:${key}`,
            status: 'fail',
            message: `Lesson "${lesson.slug}" missing required frontmatter key: "${key}".`,
            category: 'lesson',
            level: 1,
          });
        }
      }

      // Validate validation block types
      if (data.validation && Array.isArray(data.validation)) {
        for (let i = 0; i < data.validation.length; i++) {
          const v = data.validation[i];
          if (v.type && !KNOWN_VALIDATOR_TYPES.includes(v.type)) {
            results.push({
              check: `frontmatter:${lesson.slug}:validation[${i}]`,
              status: 'warn',
              message: `Lesson "${lesson.slug}" has unknown validator type "${v.type}". Did you mean one of: ${KNOWN_VALIDATOR_TYPES.join(', ')}?`,
              category: 'lesson',
              level: 1,
            });
          }
        }
      }

      // Check for duplicate keys
      const keys = [...new Set(yamlBlock.match(/^(\w+):/gm)?.map(k => k.replace(':', '').trim()) || [])];
      const seen = new Map<string, number>();
      for (const key of keys) {
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      for (const [key, count] of seen) {
        if (count > 1) {
          results.push({
            check: `frontmatter:${lesson.slug}:duplicate:${key}`,
            status: 'warn',
            message: `Lesson "${lesson.slug}" has duplicate frontmatter key "${key}". Only the last value will be used.`,
            category: 'lesson',
            level: 1,
          });
        }
      }
    } catch {
      // Skip lessons we can't read
    }
  }

  return results;
}

/**
 * Find ALL lesson files in a track directory (flat list with slugs).
 * Supports both formats:
 *   1. Folder-based: lesson-name/lesson.md
 *   2. Flat file:    lesson-name.md
 */
function findAllLessonFiles(trackDir: string): Array<{ slug: string; dir: string }> {
  const lessons: Array<{ slug: string; dir: string }> = [];
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          // Check if this directory contains a lesson.md (folder-based lesson)
          const lessonMdInDir = path.join(fullPath, 'lesson.md');
          if (fs.existsSync(lessonMdInDir)) {
            const slug = entry.name.replace(/^\d+[-_]/, '');
            lessons.push({ slug, dir: fullPath });
          } else {
            walk(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
          // Skip flat .md files if a folder with the same stem exists
          const stem = entry.name.replace(/\.md$/, '');
          const folderPath = path.join(dir, stem);
          if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) continue;
          const slug = entry.name.replace(/\.md$/, '').replace(/^\d+[-_]/, '');
          lessons.push({ slug, dir });
        }
      }
    } catch {}
  }
  walk(trackDir);
  return lessons;
}

/**
 * Get the name of the current lesson from the directory path.
 * Returns "Module / Lesson" formatted string, or null if no lesson context.
 */
export function getCurrentLessonInfo(lessonDir: string): { moduleName: string; lessonName: string } | null {
  try {
    const parts = lessonDir.split(path.sep);
    const moduleDir = parts[parts.length - 2];
    const lessonDirName = parts[parts.length - 1];
    if (!moduleDir || !lessonDirName) return null;

    const moduleName = moduleDir.replace(/^module-\d+-?/, '').replace(/[-_]/g, ' ').trim();
    const lessonName = lessonDirName.replace(/^\d+-?/, '').replace(/[-_]/g, ' ').trim();
    return {
      moduleName: moduleName.charAt(0).toUpperCase() + moduleName.slice(1),
      lessonName: lessonName.charAt(0).toUpperCase() + lessonName.slice(1),
    };
  } catch {
    return null;
  }
}

/**
 * Walk a track directory recursively to find lessons with frontmatter validation configs.
 * Supports both formats:
 *   1. Folder-based: lesson-name/lesson.md (NEW)
 *   2. Flat file:    lesson-name.md        (legacy)
 *
 * For folder-based lessons, the dir is set to the folder path so the
 * test-runner executor can find test.spec.ts alongside lesson.md.
 */
function findLessonsWithValidators(trackDir: string): Array<{ dir: string; slug: string; validators: any[] }> {
  const lessons: Array<{ dir: string; slug: string; validators: any[] }> = [];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);

        let lessonMdPath: string | null = null;

        if (entry.isDirectory() && entry.name !== 'node_modules') {
          // Check if this is a folder-based lesson (contains lesson.md)
          const possibleLessonMd = path.join(fullPath, 'lesson.md');
          if (fs.existsSync(possibleLessonMd)) {
            lessonMdPath = possibleLessonMd;
          } else {
            // Not a lesson folder — recurse into it
            walk(fullPath);
            continue;
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Skip flat .md files if a folder with the same stem exists
          const stem = entry.name.replace(/\.md$/, '');
          const folderPath = path.join(dir, stem);
          if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) continue;
          lessonMdPath = fullPath;
        }

        if (!lessonMdPath) continue;

        try {
          const content = fs.readFileSync(lessonMdPath, 'utf-8');
          const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

          if (frontmatterMatch) {
            const yamlBlock = frontmatterMatch[1];
            const validationMatch = yamlBlock.match(/validation:\s*\n([\s\S]*?)(?=\n\w+:|$)/);
            if (validationMatch) {
              const validators = parseValidationBlock(validationMatch[1]);
              if (validators.length > 0) {
                // For folder-based lessons, use the folder as dir (where test.spec.ts lives)
                // For flat files, use the module directory
                const lessonDir = entry.isDirectory() ? fullPath : dir;
                const slug = entry.name.replace(/\.md$/, '').replace(/^\d+[-_]/, '');
                lessons.push({ dir: lessonDir, slug, validators });
              }
            }
          }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip unreadable directories */ }
  }

  walk(trackDir);
  return lessons;
}

/**
 * Parse a YAML validation block from frontmatter.
 * Handles both flat and nested key-value pairs with proper indentation tracking.
 *
 * Handles formats like:
 * ```yaml
 * validation:
 *   - type: file-exists
 *     path: "src/main.ts"
 *   - type: http
 *     url: "http://localhost:3000/health"
 *     method: GET
 *     expect_status: 200
 *     headers:
 *       Authorization: "Bearer token"
 *   - type: docker
 *     check: compose-services
 *     services:
 *       - "api"
 *       - "db"
 * ```
 */
function parseValidationBlock(yamlStr: string): Record<string, any>[] {
  const validators: Record<string, any>[] = [];
  const lines = yamlStr.split('\n');

  let currentValidator: Record<string, any> | null = null;
  let currentNestedKey: string | null = null;
  let currentArray: string[] | null = null;
  let inArray = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.search(/\S/);

    // Start of a new validator (list item at top level)
    if (trimmed.startsWith('- ') && indent < 4) {
      if (currentValidator) {
        // Finalize any pending nested value
        if (currentNestedKey && currentArray) {
          currentValidator[currentNestedKey] = [...currentArray];
          currentArray = null;
          currentNestedKey = null;
          inArray = false;
        }
        validators.push(currentValidator);
      }
      currentValidator = {};
      currentNestedKey = null;
      currentArray = null;
      inArray = false;

      const afterDash = trimmed.slice(2).trim();
      const colonIdx = afterDash.indexOf(':');
      if (colonIdx !== -1) {
        const key = afterDash.slice(0, colonIdx).trim();
        const value = afterDash.slice(colonIdx + 1).trim();
        if (value) {
          currentValidator[key] = parseYamlValue(value);
        } else {
          // Value might be on next lines
          currentNestedKey = key;
        }
      }
      continue;
    }

    // Handle list items in arrays (like services list)
    if (trimmed.startsWith('- ') && inArray && currentArray) {
      currentArray.push(parseYamlValue(trimmed.slice(2).trim()) as string);
      continue;
    }

    // Handle key-value pairs
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      // Could be continuation of a value
      if (currentNestedKey && currentValidator && typeof currentValidator[currentNestedKey] === 'string') {
        currentValidator[currentNestedKey] += ' ' + trimmed;
      }
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    if (currentValidator) {
      // FINALIZE any pending array before processing new key-value pair
      if (currentNestedKey && currentArray && currentArray.length > 0 && !inArray) {
        currentValidator[currentNestedKey] = [...currentArray];
        currentArray = null;
        currentNestedKey = null;
      }

      if (!value) {
        // This could be the start of a nested block or array
        // Save previous array if exists
        if (currentNestedKey && currentArray && currentArray.length > 0) {
          currentValidator[currentNestedKey] = [...currentArray];
        }
        currentNestedKey = key;
        currentArray = [];
        inArray = true; // Assume array until proven otherwise
        continue;
      }

      // It's a simple key: value pair
      currentValidator[key] = parseYamlValue(value);
      // Reset array tracking since we're in a key: value pair, not an array
      if (inArray && currentNestedKey && currentArray && currentArray.length > 0) {
        currentValidator[currentNestedKey] = [...currentArray];
        currentArray = null;
        currentNestedKey = null;
      }
      inArray = false;
    }
  }

  // Finalize last validator
  if (currentValidator) {
    if (currentNestedKey && currentArray && currentArray.length > 0) {
      currentValidator[currentNestedKey] = [...currentArray];
    }
    validators.push(currentValidator);
  }

  return validators;
}

function parseYamlValue(value: string): any {
  const trimmed = value.trim();

  // Remove surrounding quotes
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Parse numbers
  const num = Number(trimmed);
  if (!isNaN(num) && trimmed !== '') return num;

  // Parse booleans
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  return trimmed;
}

// ─── Level 1: Project Structure Checks ─────────────────────────────

/**
 * LEVEL 1 validation: Project structure basics.
 * These checks verify the project was properly initialized and has the
 * fundamental structure expected for any 100xSystems project.
 *
 * Checks:
 * - 100xsystems.json exists and has valid schema
 * - README.md exists with content
 * - package.json exists (for TypeScript/Node projects)
 * - src/ directory exists
 * - Git repository is initialized
 */
export function checkLevel1(projectDir: string, systemSlug?: string, trackSlug?: string): ValidationResult[] {
  const results: ValidationResult[] = [];

  // 100xsystems.json — project config (created by init)
  const configPath = path.join(projectDir, PROJECT_CONFIG);
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      let configOk = true;
      if (!config.system) { configOk = false; results.push({ check: 'config', status: 'fail', message: `${PROJECT_CONFIG} missing "system" field`, category: 'structure', level: 1 }); }
      if (!config.track) { configOk = false; results.push({ check: 'config', status: 'fail', message: `${PROJECT_CONFIG} missing "track" field`, category: 'structure', level: 1 }); }
      if (!config.progress) { configOk = false; results.push({ check: 'config', status: 'fail', message: `${PROJECT_CONFIG} missing "progress" field`, category: 'structure', level: 1 }); }
      if (configOk) results.push({ check: 'config', status: 'pass', message: `${PROJECT_CONFIG} project config valid`, category: 'structure', level: 1 });
    } catch {
      results.push({ check: 'config', status: 'fail', message: `${PROJECT_CONFIG} is not valid JSON`, category: 'structure', level: 1 });
    }
  } else {
    results.push({ check: 'config', status: 'fail', message: `${PROJECT_CONFIG} not found. Run \`100x init <system>\` first.`, category: 'structure', level: 1 });
  }

  // README.md — minimal required documentation
  const readmePath = path.join(projectDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, 'utf-8').trim();
    if (content.length >= 50) {
      results.push({ check: 'readme', status: 'pass', message: 'README.md exists with content', category: 'documentation', level: 1 });
    } else {
      results.push({ check: 'readme', status: 'warn', message: 'README.md exists but is minimal (< 50 chars). Add a project description.', category: 'documentation', level: 1 });
    }
  } else {
    results.push({ check: 'readme', status: 'fail', message: 'README.md is missing. Every project needs a readme.', category: 'documentation', level: 1 });
  }

  // package.json — check if it exists (standard for JS/TS projects)
  const pkgPath = path.join(projectDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.build) {
        results.push({ check: 'package.json', status: 'pass', message: 'package.json found with build script', category: 'structure', level: 1 });
      } else {
        results.push({ check: 'package.json', status: 'warn', message: 'package.json found but missing build script', category: 'structure', level: 1 });
      }
    } catch {
      results.push({ check: 'package.json', status: 'warn', message: 'package.json found but invalid', category: 'structure', level: 1 });
    }
  } else {
    // Non-JS track — check for track-appropriate files
    if (trackSlug?.includes('spring-boot')) {
      const pomPath = path.join(projectDir, 'pom.xml');
      if (fs.existsSync(pomPath)) {
        results.push({ check: 'pom.xml', status: 'pass', message: 'pom.xml found (Maven project)', category: 'structure', level: 1 });
      } else {
        const gradlePath = path.join(projectDir, 'build.gradle');
        if (fs.existsSync(gradlePath)) {
          results.push({ check: 'build.gradle', status: 'pass', message: 'build.gradle found (Gradle project)', category: 'structure', level: 1 });
        }
      }
    }
  }

  // src/ directory — check if it exists
  const srcDir = path.join(projectDir, 'src');
  if (fs.existsSync(srcDir)) {
    const srcItems = fs.readdirSync(srcDir).filter(f => !f.startsWith('.'));
    if (srcItems.length > 0) {
      results.push({ check: 'src/', status: 'pass', message: `src/ directory exists with ${srcItems.length} item(s)`, category: 'structure', level: 1 });
    } else {
      results.push({ check: 'src/', status: 'warn', message: 'src/ directory exists but is empty', category: 'structure', level: 1 });
    }
  } else {
    results.push({ check: 'src/', status: 'fail', message: 'src/ directory not found. Create your source code in src/', category: 'structure', level: 1 });
  }

  // Git repository
  const gitDir = path.join(projectDir, '.git');
  if (fs.existsSync(gitDir)) {
    results.push({ check: 'git', status: 'pass', message: 'Git repository initialized', category: 'git', level: 1 });
  } else {
    results.push({ check: 'git', status: 'warn', message: 'Not a git repository. Run git init for version control.', category: 'git', level: 1 });
  }

  // 100xsystems.json config integrity — warn instead of fail since users
  // may run validation outside the monorepo (e.g., from their project dir)
  if (systemSlug && trackSlug) {
    try {
      // Use SYSTEMS_DIR() which resolves cache (~/.cache/100xsystems/repos/) or monorepo
      const curriculumDir = path.join(SYSTEMS_DIR(), systemSlug, trackSlug);
      if (fs.existsSync(curriculumDir)) {
        results.push({ check: 'curriculum', status: 'pass', message: `Curriculum found: ${systemSlug}/${trackSlug}`, category: 'structure', level: 1 });
      } else {
        results.push({ check: 'curriculum', status: 'warn', message: `Curriculum "${systemSlug}/${trackSlug}" not found locally. Try running \`100xsystems list\` first to sync from registry.`, category: 'structure', level: 1 });
      }
    } catch {
      results.push({ check: 'curriculum', status: 'warn', message: `Could not check curriculum path (running outside monorepo?)`, category: 'structure', level: 1 });
    }
  }

  return results;
}

// ─── Spec-Defined Checks (formerly in verify.ts) ──────────────────────

/**
 * Execute all spec-defined checks from the system's SPECIFICATION.md.
 * These check for file existence, doc sections, test passes, etc.
 */
async function runSpecChecksFromCurriculum(
  projectDir: string,
  systemSlug: string
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const spec = getSpec(systemSlug);
  if (!spec || spec.checks.length === 0) return results;

  for (const check of spec.checks) {
    const sr = await runSpecCheck(check, projectDir);
    const label = check.path || check.name || check.command || check.type;

    if (sr.result === 'pass') {
      results.push({
        check: `spec-${check.type}`,
        status: 'pass',
        message: `${check.type}: ${label}`,
        category: 'spec',
        level: 3,
      });
    } else if (sr.result === 'fail') {
      results.push({
        check: `spec-${check.type}`,
        status: 'fail',
        message: `${check.type}: ${label} — ${sr.hint}`,
        category: 'spec',
        level: 3,
      });
    }
  }

  return results;
}

function getFailureHint(check: SpecCheck): string {
  switch (check.type) {
    case 'file-exists': return `Create the file at: ${check.path}`;
    case 'doc-section': return `Add section "${check.name}" to ${check.path}`;
    case 'doc-contains': return `Ensure "${check.name}" is mentioned in ${check.path}`;
    case 'file-count-min': return `Expected at least ${check.name} file(s) in ${check.path}`;
    case 'test-passes': return `Run: ${check.command}`;
    case 'custom-command': return `Run: ${check.command}`;
    default: return '';
  }
}

async function runSpecCheck(check: SpecCheck, projectDir: string): Promise<{ result: 'pass' | 'fail' | 'skip'; hint: string }> {
  switch (check.type) {
    case 'file-exists': {
      if (!check.path) return { result: 'skip', hint: '' };
      const exists = fs.existsSync(path.join(projectDir, check.path));
      return exists
        ? { result: 'pass', hint: '' }
        : { result: 'fail', hint: getFailureHint(check) };
    }
    case 'doc-section': {
      if (!check.path || !check.name) return { result: 'skip', hint: '' };
      const fullPath = path.join(projectDir, check.path);
      if (!fs.existsSync(fullPath)) return { result: 'fail', hint: getFailureHint(check) };
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const pattern = new RegExp(`^##+\\s+${escapeRegex(check.name)}`, 'm');
        return pattern.test(content)
          ? { result: 'pass', hint: '' }
          : { result: 'fail', hint: getFailureHint(check) };
      } catch { return { result: 'fail', hint: '' }; }
    }
    case 'doc-contains': {
      if (!check.path || !check.name) return { result: 'skip', hint: '' };
      const fp = path.join(projectDir, check.path);
      if (!fs.existsSync(fp)) return { result: 'fail', hint: getFailureHint(check) };
      try {
        const lower = fs.readFileSync(fp, 'utf-8').toLowerCase();
        return lower.includes(check.name.toLowerCase())
          ? { result: 'pass', hint: '' }
          : { result: 'fail', hint: getFailureHint(check) };
      } catch { return { result: 'fail', hint: '' }; }
    }
    case 'file-count-min': {
      if (!check.path) return { result: 'skip', hint: '' };
      const fp2 = path.join(projectDir, check.path);
      if (!fs.existsSync(fp2)) return { result: 'fail', hint: getFailureHint(check) };
      try {
        const count = fs.readdirSync(fp2).filter((f) => !f.startsWith('.')).length;
        const min = parseInt(check.name || '1', 10) || 1;
        return count >= min
          ? { result: 'pass', hint: '' }
          : { result: 'fail', hint: getFailureHint(check) };
      } catch { return { result: 'fail', hint: '' }; }
    }
    case 'test-passes':
    case 'custom-command': {
      if (!check.command) return { result: 'skip', hint: '' };
      try {
        execSync(check.command, { cwd: projectDir, stdio: 'pipe', timeout: 60000 });
        return { result: 'pass', hint: '' };
      } catch { return { result: 'fail', hint: getFailureHint(check) }; }
    }
    default:
      return { result: 'skip', hint: '' };
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

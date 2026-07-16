/**
 * ## Regex Executor
 *
 * Searches files in the project for patterns using regular expressions.
 * Useful for checking that specific code patterns, annotations, or configurations exist.
 *
 * @example
 * validation:
 *   - type: regex
 *     pattern: "@RestController"
 *     paths: ["src/main/java/**&#47;*.java"]
 *     min_matches: 1
 *     description: "Has at least one REST controller"
 *
 *   - type: regex
 *     pattern: "implements\\s+.*Repository"
 *     paths: ["src/**&#47;*.java"]
 *     min_matches: 1
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next', '.cache', 'coverage']);

export class RegexExecutor implements Executor {
  type = 'regex';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const pattern = params.pattern as string;
    if (!pattern) {
      return {
        check: 'regex',
        status: 'fail',
        message: 'Missing "pattern" parameter in validator config',
        category: 'validation',
      };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, params.flags as string || 'g');
    } catch (err: any) {
      return {
        check: 'regex',
        status: 'error',
        message: `Invalid regex pattern "${pattern}": ${err.message}`,
        category: 'validation',
      };
    }

    const searchPaths = (params.paths as string[]) || ['src'];
    const minMatches = (params.min_matches as number) || 1;
    const description = (params.description as string) || `Pattern: ${pattern}`;

    let totalMatches = 0;
    const matches: Array<{ file: string; line: number }> = [];

    for (const searchPath of searchPaths) {
      const fullPath = path.resolve(ctx.projectDir, searchPath);
      if (!fs.existsSync(fullPath)) continue;

      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        walkDirectory(fullPath, searchPath, regex, matches);
      } else if (stats.isFile()) {
        searchInFile(fullPath, searchPath, regex, matches);
      }
    }

    totalMatches = matches.length;

    if (totalMatches < minMatches) {
      return {
        check: `regex:${description}`,
        status: 'fail',
        message: `${description}: expected at least ${minMatches} match(es), found ${totalMatches}`,
        details: matches.length > 0
          ? `Found in: ${matches.slice(0, 5).map(m => `${m.file}:${m.line}`).join(', ')}`
          : 'No matches found',
        category: 'validation',
      };
    }

    return {
      check: `regex:${description}`,
      status: 'pass',
      message: `${description}: found ${totalMatches} match(es)`,
      details: matches.length > 0
        ? `In: ${matches.slice(0, 3).map(m => `${m.file}:${m.line}`).join(', ')}`
        : undefined,
      category: 'validation',
    };
  }
}

function walkDirectory(
  dir: string,
  relativeRoot: string,
  regex: RegExp,
  matches: Array<{ file: string; line: number }>
): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDirectory(fullPath, relativeRoot, regex, matches);
      } else if (entry.isFile()) {
        const relPath = path.relative(relativeRoot, fullPath);
        if (isSourceFile(entry.name)) {
          searchInFile(fullPath, relPath, regex, matches);
        }
      }
    }
  } catch { /* skip unreadable */ }
}

function searchInFile(
  fullPath: string,
  relativePath: string,
  regex: RegExp,
  matches: Array<{ file: string; line: number }>
): void {
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ file: relativePath, line: i + 1 });
        regex.lastIndex = 0; // Reset for the next test
      }
    }
  } catch { /* skip unreadable */ }
}

function isSourceFile(filename: string): boolean {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.java', '.py', '.go', '.rs', '.kt', '.swift'];
  return extensions.some(ext => filename.endsWith(ext));
}

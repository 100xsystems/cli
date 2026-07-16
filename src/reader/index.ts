import fs from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';

// ─── Paths ──────────────────────────────────────────────────────────

/**
 * The CLI resolves systems and submissions through a layered strategy:
 *
 *   1. CURRICULUM_PATH env var — development override
 *   2. Systems cache at ~/.cache/100xsystems/repos/ — downloaded system repos
 *   3. Local fallback (curriculum/ in monorepo) — backward compat
 *
 * The REGISTRY_URL points to the 100xSystems registry repository, which
 * contains an index of all available system repositories.
 */

const XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
export const SYSTEMS_CACHE_DIR = () => path.join(XDG_CACHE_HOME, '100xsystems', 'repos');
export const REGISTRY_URL = 'https://raw.githubusercontent.com/100xsystems/registry/main/registry.json';

/**
 * Find the repo root by checking:
 *   1. CURRICULUM_PATH env var (overrides everything — for running outside repo)
 *   2. Walk up from cwd looking for curriculum/ directory
 *   3. Fallback: check if parent of cwd has curriculum/
 */
function findRootDir(): string {
  // Allow override via env var so users can scaffold projects from anywhere
  const envPath = process.env.CURRICULUM_PATH;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, 'curriculum'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  // Fallback: maybe we're in cli/ and curriculum is a sibling
  const cliParent = path.resolve(process.cwd(), '..');
  if (fs.existsSync(path.join(cliParent, 'curriculum'))) {
    return cliParent;
  }
  return process.cwd();
}

let _rootDir: string | null = null;
function getRootDir(): string {
  if (!_rootDir) _rootDir = findRootDir();
  return _rootDir;
}

// Export findRootDir so that validate.ts (and other consumers) can resolve the
// curriculum path without importing from a non-public API.
export const resolveRootDir = getRootDir;

export const CURRICULUM_DIR = () => path.join(getRootDir(), 'curriculum');

/**
 * Resolve the systems directory.
 *
 * Priority:
 *   1. Env var CURRICULUM_PATH (if set and points to a valid dir)
 *   2. Systems cache at ~/.cache/100xsystems/repos/ (populated by `registry sync` + `init`)
 *   3. Local curriculum/systems/ in monorepo (backward compat for development)
 */
export const SYSTEMS_DIR = () => {
  // 1. Env var override
  const envPath = process.env.CURRICULUM_PATH;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (fs.existsSync(resolved)) return resolved;
  }

  // 2. Systems cache (repos cloned from registry)
  const cacheDir = SYSTEMS_CACHE_DIR();
  if (fs.existsSync(cacheDir)) {
    const entries = fs.readdirSync(cacheDir).filter((e) => {
      const fullPath = path.join(cacheDir, e);
      try { return fs.statSync(fullPath).isDirectory(); } catch { return false; }
    });
    if (entries.length > 0) return cacheDir;
  }

  // 3. Local fallback (backward compat)
  const localPath = path.join(getRootDir(), 'curriculum', 'systems');
  if (fs.existsSync(localPath)) return localPath;

  // 4. Create cache dir so it's ready for sync
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
};

/**
 * Download and cache a system repository from the registry.
 * Clones shallowly into ~/.cache/100xsystems/repos/{slug}/.
 */
export async function syncSystemFromRegistry(slug: string, repoUrl: string): Promise<string> {
  const cacheDir = SYSTEMS_CACHE_DIR();
  const targetDir = path.join(cacheDir, slug);

  // If already cached, just return the path
  if (fs.existsSync(targetDir) && fs.existsSync(path.join(targetDir, 'index.md'))) {
    return targetDir;
  }

  // Clone the repo
  fs.mkdirSync(cacheDir, { recursive: true });
  const cloneUrl = `https://${repoUrl}`.replace(/^https:\/\/https:\/\//, 'https://');

  try {
    await execa('git', ['clone', '--depth=1', cloneUrl, targetDir], {
      timeout: 60_000,
      stdio: 'pipe',
    });
  } catch (err: any) {
    throw new Error(`Failed to download system "${slug}" from ${cloneUrl}: ${err.message}`);
  }

  return targetDir;
}

/**
 * Fetch the registry JSON from GitHub.
 */
export async function fetchRegistry(): Promise<any> {
  const https = await import('https');

  return new Promise((resolve, reject) => {
    const TIMEOUT = 15_000;
    const opts = { headers: { 'User-Agent': '100xSystems-CLI/1.0' }, timeout: TIMEOUT };

    const handleResponse = (res: any, resolveFn: (v: any) => void, rejectFn: (e: Error) => void) => {
      let body = '';
      res.on('data', (chunk: string) => body += chunk);
      res.on('end', () => {
        try { resolveFn(JSON.parse(body)); } catch { rejectFn(new Error('Failed to parse registry JSON')); }
      });
    };

    const req = https.get(REGISTRY_URL, opts, (res) => {
      // Handle GitHub redirects (raw.githubusercontent.com may redirect)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow the redirect — don't consume the original response
        res.destroy();
        const redirReq = https.get(res.headers.location, opts, (res2) => {
          handleResponse(res2, resolve, reject);
        });
        redirReq.on('error', reject);
        redirReq.setTimeout(TIMEOUT, () => { redirReq.destroy(new Error('Registry request timed out')); });
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Registry responded with ${res.statusCode}`));
        return;
      }
      handleResponse(res, resolve, reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT, () => { req.destroy(new Error('Registry request timed out')); });
  });
}

export const KNOWLEDGE_BASE_DIR = () => path.join(getRootDir(), 'curriculum', 'knowledge-base');
export const SUBMISSIONS_DIR = () => path.join(getRootDir(), 'submissions');

// ─── Helpers ────────────────────────────────────────────────────────

export function isDirectory(dir: string): boolean {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

export function slugToDisplayName(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function fileToSlug(filename: string): string {
  const base = filename.replace(/\.md$/, '');
  return base.replace(/^\d+[-_]/, '');
}

export function getOrderFromFile(filename: string, frontmatterOrder?: number): number {
  if (frontmatterOrder !== undefined) return frontmatterOrder;
  const match = filename.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 999;
}

// ─── Consolidated Frontmatter Parser ────────────────────────────────
// Single parser that handles: simple values, arrays of strings,
// arrays of objects with nested properties, and nested objects.
// Used by all readers instead of 5 separate parsers.

export function parseFrontmatter(raw: string): { data: Record<string, any>; content: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const yamlStr = match[1];
  const content = match[2];
  return { data: parseYamlBlock(yamlStr), content };
}

function parseYamlBlock(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split('\n');

  let currentKey = '';
  let currentArray: any[] = [];
  let inArray = false;
  let inObject = false;
  let objectBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);
    const isTopLevel = indent === 0;

    if (isTopLevel && currentKey && (inArray || inObject)) {
      if (inObject && objectBuf.length > 0) {
        result[currentKey] = parseYamlBlock(objectBuf.join('\n'));
        objectBuf = [];
        inObject = false;
      }
      if (inArray && currentArray.length > 0) {
        result[currentKey] = currentArray;
        currentArray = [];
        inArray = false;
      }
      currentKey = '';
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('-')) {
      if (!inArray) {
        for (let j = i - 1; j >= 0; j--) {
          const prevLine = lines[j];
          if (prevLine.search(/\S/) === 0) {
            const ci = prevLine.indexOf(':');
            if (ci !== -1 && prevLine.slice(ci + 1).trim() === '') {
              currentKey = prevLine.slice(0, ci).trim();
              break;
            }
          }
        }
        inArray = true;
      }

      const itemStr = trimmed.replace(/^- /, '').trim();

      const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
      const nextIndent = nextLine ? nextLine.search(/\S/) : 0;

      if (nextLine && nextIndent > indent && itemStr.includes(':')) {
        const subLines: string[] = [itemStr];
        let j = i + 1;
        while (j < lines.length) {
          const sl = lines[j];
          if (sl.search(/\S/) <= indent) break;
          subLines.push(sl.slice(indent + 2));
          j++;
        }
        const obj = parseYamlBlock(subLines.join('\n'));
        currentArray.push(obj);
        i = j - 1;
      } else {
        currentArray.push(parseValue(itemStr));
      }
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      if (inObject && currentKey) {
        objectBuf.push(line);
      }
      continue;
    }

    const key = line.slice(colonIdx).includes(':') ?
      line.slice(0, colonIdx).trim() : trimmed.slice(0, trimmed.indexOf(':')).trim();
    let value = line.slice(colonIdx + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value.slice(1, -1).split(',').map((s) => parseValue(s.trim()));
      continue;
    }

    if (value === '') {
      currentKey = key;
      inObject = true;
      objectBuf = [];
      continue;
    }

    if (inObject && currentKey) {
      objectBuf.push(line);
    } else {
      result[key] = parseValue(value);
    }
  }

  if (inObject && currentKey && objectBuf.length > 0) {
    result[currentKey] = parseYamlBlock(objectBuf.join('\n'));
  }
  if (inArray && currentKey && currentArray.length > 0) {
    result[currentKey] = currentArray;
  }

  return result;
}

function parseValue(value: string): any {
  const t = value.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  const num = Number(t);
  if (!isNaN(num) && t !== '') return num;
  return t;
}

// ─── Markdown Reading ───────────────────────────────────────────────

export interface ParsedMd {
  filename: string;
  content: string;
  data: Record<string, any>;
}

export function readMdFiles(dir: string): ParsedMd[] {
  const results: ParsedMd[] = [];
  if (!fs.existsSync(dir)) return results;

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  for (const filename of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, filename), 'utf-8');
      const { data, content } = parseFrontmatter(raw);
      results.push({ filename, content, data });
    } catch {}
  }

  return results;
}

// ─── Types ──────────────────────────────────────────────────────────

export interface SystemInfo {
  slug: string;
  title: string;
  description: string;
  difficulty: string;
  tags: string[];
  order: number;
}

export interface FolderEntry {
  type: 'file' | 'folder';
  slug: string;
  title: string;
  order: number;
}

export interface FolderTag {
  tag: string;
  displayName: string;
  children: FolderEntry[];
}

export interface QuizQuestion {
  question: string;
  type: 'multiple-choice' | 'true-false';
  choices?: { label: string; value: string }[];
  answer: string | boolean;
}

export interface QuizData {
  title: string;
  order: number;
  questions: QuizQuestion[];
}

export interface SpecCheck {
  type: string;
  path?: string;
  file?: string;
  name?: string;
  command?: string;
  dockerfile?: string;
  url?: string;
  method?: string;
  'expect-status'?: number;
}

export interface SpecData {
  title: string;
  version: string;
  checks: SpecCheck[];
}

export interface ResourceLink {
  title: string;
  url: string;
  type: 'article' | 'video' | 'paper' | 'blog' | 'documentation' | 'tool';
  description?: string;
}

export interface ResourceCategory {
  name: string;
  items: ResourceLink[];
}

export interface SystemResources {
  system: string;
  categories: ResourceCategory[];
}

export interface ProgressEntry {
  status: 'not-started' | 'in-progress' | 'completed';
  startedAt?: string;
  completedAt?: string;
  projectDir?: string;
  language?: string;
  currentLesson?: string;  // slug of the lesson the user is currently working on
}

export interface ProgressData {
  systems: Record<string, ProgressEntry>;
}

export interface SubmissionMetadata {
  system: string;
  systemTitle: string;
  author: string;
  language: string;
  repositoryUrl: string;
  difficulty: string;
  tags: string[];
  submittedAt: string;
  prUrl?: string;
  status: 'pending' | 'in-review' | 'changes-requested' | 'accepted' | 'rejected';
  reviewers?: string[];
}

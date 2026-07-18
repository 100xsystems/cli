import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ensureAuthenticated } from '../auth/index.js';
import { getSystemMeta } from '../reader/system-reader.js';
import { readProjectConfig, PROJECT_CONFIG } from '../scaffold/index.js';
import { SUBMISSIONS_DIR } from '../reader/index.js';
import { runValidation } from './validate.js';

// ─── Constants ──────────────────────────────────────────────────────

/** Source file extensions allowed in submissions (text-only, no binaries) */
const ALLOWED_SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.go', '.rs', '.py', '.java', '.kt', '.swift',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.md', '.css', '.scss', '.html',
  '.sh', '.bash', '.zsh',
  '.sql', '.graphql',
  '.proto',
]);

/** Directories to always exclude from source collection */
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'target', '.git',
  '.next', '.cache', 'coverage', '.nyc_output',
  'vendor', '.gradle', 'gradle', '.idea', '.vscode',
]);

/** Max individual file size in bytes for source collection */
const MAX_FILE_SIZE = 500 * 1024; // 500KB

/** Max total packaged size in bytes before halting submission */
const MAX_TOTAL_SIZE = 5 * 1024 * 1024; // 5MB

// ─── Types ──────────────────────────────────────────────────────────

export interface SubmitAnswers {
  repositoryUrl: string;
  language: string;
  difficulty: string;
}

export interface BuildResult {
  slug: string;
  reviewDirName: string;
  user: string;
  metadata: Record<string, any>;
  projectDir: string;
  systemTitle: string;
  /** List of source files collected for submission */
  collectedSources: string[];
  /** Total size of collected source files in bytes */
  totalSourceSize: number;
}

export interface ProjectConfig {
  config: Record<string, any>;
  slug: string;
  projectDir: string;
}

// ─── Exported functions (no I/O — the Pastel command handles display) ─

/**
 * Read and validate the project config.
 * Returns null if no config found.
 */
export function readSubmitConfig(projectDir: string, systemSlug?: string): ProjectConfig | null {
  const config = readProjectConfig(projectDir);
  if (!config) return null;

  const slug = systemSlug || (config.system as string);
  return { config, slug, projectDir };
}

/**
 * Authenticate with GitHub and return the username.
 */
export async function authenticateGitHub(): Promise<string> {
  const auth = await ensureAuthenticated();
  return auth.user;
}

/**
 * Authenticate with GitHub and return both the access token and username.
 */
export async function authenticateGitHubWithToken(): Promise<{ token: string; user: string }> {
  const auth = await ensureAuthenticated();
  return { token: auth.token, user: auth.user };
}

/**
 * Detect the git remote URL for the project.
 */
export function detectGitRemote(projectDir: string): string | null {
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 5000,
    }).toString().trim();
    if (remote) {
      if (remote.startsWith('git@')) {
        return remote.replace('git@', 'https://').replace('.com:', '.com/').replace(/\.git$/, '');
      }
      return remote.replace(/\.git$/, '');
    }
  } catch {
    // No git remote
  }
  return null;
}

/**
 * Generate a review directory name.
 */
export function reviewDirName(user: string, language: string): string {
  const timestamp = Date.now();
  return `${user}-${language}-${timestamp}`;
}

/**
 * Build the review package: create directory, copy docs, collect source code, write metadata.
 * 
 * The review package includes:
 * - Documentation files (README, design docs, spec)
 * - Filtered source code from src/ (whitelisted extensions, no binaries)
 * - 100xsystems.json project config
 * - metadata.json with submission details
 * 
 * Source code is included with the submission to create a permanent,
 * self-contained record of the implementation. File size limits prevent
 * repository bloat.
 */
export function buildReviewPackage(
  projectDir: string,
  slug: string,
  user: string,
  answers: SubmitAnswers
): BuildResult {
  const systemMeta = getSystemMeta(slug);
  const config = readProjectConfig(projectDir);
  const systemTitle = config?.systemTitle || systemMeta?.title || slug;

  const timestamp = Date.now();
  const rDirName = `${user}-${answers.language}-${timestamp}`;
  const reviewDir = path.join(SUBMISSIONS_DIR(), slug, rDirName);
  fs.mkdirSync(reviewDir, { recursive: true });

  // ── Copy Documentation Files ──────────────────────────────────────
  const docFiles = [
    { src: 'README.md', dest: 'README.md' },
    { src: 'design/decisions.md', dest: 'design/decisions.md' },
    { src: 'design/architecture.md', dest: 'design/architecture.md' },
    { src: 'design/tradeoffs.md', dest: 'design/tradeoffs.md' },
    { src: 'verification/checklist.md', dest: 'verification/checklist.md' },
    { src: 'SPECIFICATION.md', dest: 'specification/SPECIFICATION.md' },
  ];

  for (const file of docFiles) {
    const srcPath = path.join(projectDir, file.src);
    if (fs.existsSync(srcPath)) {
      const destPath = path.join(reviewDir, file.dest);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // ── Collect and Copy Source Code ──────────────────────────────────
  // Whitelisted source files only — prevents binary/repo bloat.
  // Each file must be under 500KB, total must be under 5MB.
  const collectedSources = collectSourceFiles(projectDir);
  let totalSourceSize = 0;

  for (const filePath of collectedSources) {
    const relPath = path.relative(projectDir, filePath);
    const destPath = path.join(reviewDir, 'src', relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(filePath, destPath);
    totalSourceSize += fs.statSync(filePath).size;
  }

  // ── Copy 100xsystems.json ─────────────────────────────────────────
  const configSrc = path.join(projectDir, PROJECT_CONFIG);
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, path.join(reviewDir, PROJECT_CONFIG));
  }

  // ── Generate Metadata ─────────────────────────────────────────────
  const metadata = {
    system: slug,
    systemTitle,
    author: user,
    language: answers.language,
    repositoryUrl: answers.repositoryUrl,
    difficulty: answers.difficulty,
    tags: systemMeta?.tags || [],
    submittedAt: new Date().toISOString(),
    status: 'pending',
    pullRequestUrl: null as string | null,
    certificateId: null as string | null,
    sourceFiles: collectedSources.length,
    sourceSizeBytes: totalSourceSize,
  };

  fs.writeFileSync(
    path.join(reviewDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2) + '\n',
  );

  return {
    slug,
    reviewDirName: rDirName,
    user,
    metadata,
    projectDir,
    systemTitle,
    collectedSources,
    totalSourceSize,
  };
}

// ─── Source File Collection ─────────────────────────────────────────

/**
 * Collect source files from the project directory.
 * Applies strict filtering:
 * - Only whitelisted extensions (text source files)
 * - Skips excluded directories (node_modules, dist, .git, etc.)
 * - Skips dotfiles
 * - Each file must be under 500KB
 * - Total size must be under 5MB
 */
function collectSourceFiles(projectDir: string): string[] {
  const collected: string[] = [];
  let totalSize = 0;

  function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip hidden files/directories
      if (entry.name.startsWith('.')) continue;
      // Skip excluded directories
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();

        // Only allow whitelisted extensions
        if (!ALLOWED_SOURCE_EXTENSIONS.has(ext)) continue;

        // Check individual file size
        let stat: fs.Stats;
        try { stat = fs.statSync(fullPath); } catch { continue; }

        if (stat.size > MAX_FILE_SIZE) continue;

        // Check total size would still be under limit
        if (totalSize + stat.size > MAX_TOTAL_SIZE) {
          console.error(`  ⚠️  Skipping ${entry.name}: total would exceed ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit`);
          continue;
        }

        totalSize += stat.size;
        collected.push(fullPath);
      }
    }
  }

  // Walk the src/ directory
  const srcDir = path.join(projectDir, 'src');
  if (fs.existsSync(srcDir)) {
    walk(srcDir);
  }

  // Also collect root-level config files and build manifests
  const rootFiles = [
    'package.json', 'tsconfig.json', 'Dockerfile', 'docker-compose.yml', '.env.example',
    'pom.xml', 'build.gradle', 'Cargo.toml', 'go.mod', 'go.sum', 'Makefile',
    'requirements.txt', 'Pipfile', 'Gemfile', 'Gemfile.lock',
  ];
  for (const rootFile of rootFiles) {
    const fp = path.join(projectDir, rootFile);
    if (fs.existsSync(fp) && fs.statSync(fp).size <= MAX_FILE_SIZE && !collected.includes(fp)) {
      collected.push(fp);
    }
  }

  // Also collect root-level entry point source files that might not be in src/
  const rootEntries = ['index.ts', 'main.ts', 'main.go', 'main.rs', 'main.py', 'app.py', 'app.ts'];
  for (const entry of rootEntries) {
    const fp = path.join(projectDir, entry);
    if (fs.existsSync(fp) && fs.statSync(fp).size <= MAX_FILE_SIZE && !collected.includes(fp)) {
      collected.push(fp);
    }
  }

  return collected;
}

/**
 * Store the PR URL back into the project's 100xsystems.json.
 * This creates a permanent audit trail linking the local project
 * to its submission PR on GitHub.
 */
export function storePrUrlInProjectConfig(projectDir: string, prUrl: string, prNumber: number): void {
  try {
    const configPath = path.join(projectDir, PROJECT_CONFIG);
    if (!fs.existsSync(configPath)) return;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.submitted = {
      prUrl,
      prNumber,
      submittedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  } catch {
    // Best effort — non-critical
  }
}

/**
 * Update the submissions index file.
 */
export function updateSubmissionsIndex(slug: string, metadata: Record<string, any>): void {
  const indexFile = path.join(SUBMISSIONS_DIR(), 'submissions.json');

  let index: Record<string, any[]> = {};
  if (fs.existsSync(indexFile)) {
    try {
      index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    } catch {
      index = {};
    }
  }

  if (!index[slug]) {
    index[slug] = [];
  }

  index[slug].push({
    ...metadata,
    submittedAt: new Date().toISOString(),
  });

  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
}

/**
 * Mark the system as completed in local progress.
 */
export function markProjectCompleted(slug: string): void {
  try {
    // Use already-imported fs and path (synchronous, no circular dep)
    const progressDir = process.env.HOME || process.env.USERPROFILE || '~';
    const progressFile = path.join(progressDir, '.100x', 'progress.json');
    let data: Record<string, any> = { systems: {} };
    if (fs.existsSync(progressFile)) {
      data = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    }
    if (!data.systems) data.systems = {};
    data.systems[slug] = { ...data.systems[slug], status: 'completed', completedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.writeFileSync(progressFile, JSON.stringify(data, null, 2));
  } catch {
    // Silently fail — non-critical
  }
}

/**
 * Check if we're inside the 100xsystems monorepo.
 */
export function isInsideMonorepo(): boolean {
  return fs.existsSync(path.join(process.cwd(), '..', 'curriculum')) ||
    fs.existsSync(path.join(process.cwd(), '..', '..', 'curriculum'));
}

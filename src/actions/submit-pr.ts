/**
 * ## Submit PR Action
 *
 * Automates the GitHub Pull Request workflow for submitting a review package.
 *
 * Flow:
 *   1. Authenticate via GitHub token (already cached by auth module)
 *   2. Fork `100xsystems/submissions` (if not already forked)
 *   3. Clone the fork to a temp directory
 *   4. Copy the review package files into the fork
 *   5. Commit and push
 *   6. Create a Pull Request against `100xsystems/submissions`
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ensureAuthenticated } from '../auth/index.js';
import { SUBMISSIONS_DIR } from '../reader/index.js';
import { PROJECT_CONFIG } from '../scaffold/index.js';
import type { BuildResult } from './submit.js';
import { storePrUrlInProjectConfig } from './submit.js';

// ─── Constants ──────────────────────────────────────────────────────

const UPSTREAM_OWNER = process.env.SUBMISSIONS_OWNER || 'aryanbatras';
const UPSTREAM_REPO = 'submissions';
const UPSTREAM_BRANCH = 'main';
const GITHUB_API = 'https://api.github.com';
const TEMP_DIR_BASE = () => path.resolve(process.env.HOME || process.env.USERPROFILE || '~', '.100x', 'tmp');

// ─── Types ──────────────────────────────────────────────────────────

export interface PrResult {
  prUrl: string;
  prNumber: number;
  forkOwner: string;
  forkBranch: string;
  reviewDir: string;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Submit a review package as a Pull Request to 100xsystems/submissions.
 *
 * @param result — The BuildResult from buildReviewPackage()
 * @returns PR URL, number, and fork details
 */
export async function submitPullRequest(result: BuildResult): Promise<PrResult> {
  // 1. Get authenticated token
  const auth = await ensureAuthenticated();
  const githubToken = auth.token;
  const username = auth.user;

  console.error(`  Authenticated as ${username}`);

  // 2. Ensure fork exists
  const forkOwner = username;
  await ensureFork(githubToken, forkOwner);

  // 3. Clone the fork
  const tempDir = path.join(TEMP_DIR_BASE(), `pr-${result.slug}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const forkBranch = `submission/${result.slug}/${result.reviewDirName}`;

  console.error(`  Cloning fork to temporary directory...`);
  cloneFork(tempDir, forkOwner, githubToken);

  // 4. Copy review package into fork
  const reviewDir = path.join(SUBMISSIONS_DIR(), result.slug, result.reviewDirName);
  if (!fs.existsSync(reviewDir)) {
    throw new Error(
      `Review package not found at ${reviewDir}.\n` +
      `  Run \`100xsystems submit\` again to build the review package first.`
    );
  }

  // Copy everything from the review package into the fork's submissions/{slug}/ dir
  const forkSubmissionsDir = path.join(tempDir, result.slug);
  fs.mkdirSync(forkSubmissionsDir, { recursive: true });
  copyRecursive(reviewDir, forkSubmissionsDir);

  console.error(`  Copied review package to fork`);

  // 5. Commit and push
  commitAndPush(tempDir, forkBranch, result, githubToken, forkOwner);

  // 6. Create PR
  const prData = await createPullRequest(
    githubToken,
    forkOwner,
    forkBranch,
    result,
    username,
  );

  // 7. Update local metadata with PR URL
  updateLocalMetadata(result, prData.html_url, prData.number);

  // 7b. Store PR URL in the project's 100xsystems.json for permanent audit trail
  storePrUrlInProjectConfig(result.projectDir, prData.html_url, prData.number);
  console.error(`  Updated ${PROJECT_CONFIG} with PR URL`);

  // 8. Cleanup temp directory
  fs.rmSync(tempDir, { recursive: true, force: true });

  return {
    prUrl: prData.html_url,
    prNumber: prData.number,
    forkOwner,
    forkBranch,
    reviewDir: result.reviewDirName,
  };
}

// ─── Fork Management ────────────────────────────────────────────────

async function ensureFork(token: string, forkOwner: string): Promise<void> {
  const url = `${GITHUB_API}/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': '100xsystems-cli/0.1.0',
    },
    body: JSON.stringify({}),
  });

  if (response.status === 202) {
    // Fork is being created — this is normal for the first time
    console.error(`  Fork created (may take a few seconds to clone)...`);
    // Give GitHub a moment to set up the fork
    await sleep(3000);
  } else if (response.status === 403) {
    // Already exists — this is fine
    console.error(`  Fork already exists`);
  } else if (!response.ok && response.status !== 403) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Failed to create fork: ${response.status} ${errText}`);
  }

  // Verify fork exists by checking if the repo is accessible
  const verifyUrl = `${GITHUB_API}/repos/${forkOwner}/${UPSTREAM_REPO}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const verifyRes = await fetch(verifyUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': '100xsystems-cli/0.1.0',
      },
    });
    if (verifyRes.ok) return;
    await sleep(2000);
  }

  throw new Error(
    `Could not verify fork at ${forkOwner}/${UPSTREAM_REPO}.\n` +
    `  Check if the fork was created: https://github.com/${forkOwner}/${UPSTREAM_REPO}`
  );
}

// ─── Clone ──────────────────────────────────────────────────────────

function cloneFork(tempDir: string, forkOwner: string, token: string): void {
  const cloneUrl = `https://x-access-token:${token}@github.com/${forkOwner}/${UPSTREAM_REPO}.git`;

  execSync(`git clone --depth 1 ${cloneUrl} .`, {
    cwd: tempDir,
    stdio: 'pipe',
    timeout: 60_000,
  });

  // Configure git user for this repo
  execSync(`git config user.email "cli@100xsystems.dev"`, { cwd: tempDir, stdio: 'pipe' });
  execSync(`git config user.name "100xSystems CLI"`, { cwd: tempDir, stdio: 'pipe' });
}

// ─── Copy ───────────────────────────────────────────────────────────

function copyRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Commit & Push ──────────────────────────────────────────────────

function commitAndPush(
  tempDir: string,
  branchName: string,
  result: BuildResult,
  token: string,
  forkOwner: string,
): void {
  // Add all files in the temp dir (the submissions/{slug} directory)
  execSync(`git checkout -b ${branchName}`, { cwd: tempDir, stdio: 'pipe', timeout: 15_000 });

  // Add the specific system directory
  execSync(`git add ${result.slug}/`, {
    cwd: tempDir,
    stdio: 'pipe',
    timeout: 15_000,
  });

  // Commit
  const commitMessage = `submission: ${result.slug} by ${result.user}\n\nSystem: ${result.slug}\nLanguage: ${result.metadata.language}\nDifficulty: ${result.metadata.difficulty}\nRepository: ${result.metadata.repositoryUrl}`;

  execSync(`git commit -m "${escapeShell(commitMessage)}"`, {
    cwd: tempDir,
    stdio: 'pipe',
    timeout: 15_000,
  });

  // Push
  const pushUrl = `https://x-access-token:${token}@github.com/${forkOwner}/${UPSTREAM_REPO}.git`;
  execSync(`git push ${pushUrl} ${branchName}`, {
    cwd: tempDir,
    stdio: 'pipe',
    timeout: 60_000,
  });

  console.error(`  Pushed to ${forkOwner}/${UPSTREAM_REPO}:${branchName}`);
}

// ─── Create PR ──────────────────────────────────────────────────────

interface GitHubPrResponse {
  html_url: string;
  number: number;
}

async function createPullRequest(
  token: string,
  forkOwner: string,
  branchName: string,
  result: BuildResult,
  username: string,
): Promise<GitHubPrResponse> {
  const url = `${GITHUB_API}/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`;

  const prBody = [
    `## ${result.systemTitle} — Submission`,
    '',
    `**Author:** @${username}`,
    `**System:** ${result.slug}`,
    `**Language:** ${result.metadata.language}`,
    `**Difficulty:** ${result.metadata.difficulty}`,
    `**Repository:** ${result.metadata.repositoryUrl}`,
    '',
    '---',
    '',
    '### Review Package Contents',
    '',
    'This PR contains the following review documentation:',
    '',
    '- `README.md` — Project overview',
    '- `design/decisions.md` — Engineering Decision Log',
    '- `design/architecture.md` — Architecture explanation',
    '- `design/tradeoffs.md` — Trade-offs analysis',
    '- `verification/checklist.md` — Self-assessment checklist',
    '- `specification/SPECIFICATION.md` — System specification',
    '- `metadata.json` — Submission metadata',
    '',
    '---',
    '',
    '### Reviewer Checklist',
    '',
    '- [ ] Architecture is well-documented',
    '- [ ] Design decisions are justified',
    '- [ ] Trade-offs are acknowledged',
    '- [ ] Source code matches the architecture',
    '- [ ] Implementation meets the specification',
    '',
    '---',
    '',
    '_Generated by [100xSystems CLI](https://github.com/100xsystems/100xsystems)_',
  ].join('\n');

  const body = JSON.stringify({
    title: `[${result.slug}] Submission by ${username} — ${result.metadata.language}`,
    body: prBody,
    head: `${forkOwner}:${branchName}`,
    base: UPSTREAM_BRANCH,
    maintainer_can_modify: true,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': '100xsystems-cli/0.1.0',
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Failed to create Pull Request: ${response.status}\n${errText}\n\n` +
      `  If this persists, create the PR manually:\n` +
      `  https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/compare`
    );
  }

  const prData = await response.json() as GitHubPrResponse;
  console.error(`  Pull Request created: ${prData.html_url}`);

  return prData;
}

// ─── Local Metadata Update ──────────────────────────────────────────

function updateLocalMetadata(result: BuildResult, prUrl: string, prNumber: number): void {
  const metadataPath = path.join(
    SUBMISSIONS_DIR(),
    result.slug,
    result.reviewDirName,
    'metadata.json',
  );

  try {
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      metadata.pullRequestUrl = prUrl;
      metadata.prNumber = prNumber;
      metadata.status = 'pending';
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
    }
  } catch {
    // Best effort — non-critical
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function escapeShell(str: string): string {
  // Escape both single quotes and double quotes for shell safety
  return str
    .replace(/'/g, "'\\''")
    .replace(/"/g, '\\"');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

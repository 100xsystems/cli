/**
 * ## Verify Solutions Action
 *
 * Cumulatively verifies that all lesson solutions compile and pass their
 * tests. This is the core of the automated E2E test system:
 *
 *   1. Scaffolds a fresh project
 *   2. For each lesson L1..Ln:
 *      a. Copies all solution files from lessons 1..i into the project
 *      b. Runs 'npx tsc --noEmit' to check compilation
 *      c. Runs 'npx vitest run' to check behavioral tests
 *      d. Records pass/fail
 *   3. Generates a comprehensive report
 *
 * This catches:
 *   - Test ↔ Solution drift (test expects file X but solution has Y)
 *   - Cross-lesson regression (lesson 5's solution breaks something lesson 3 needed)
 *   - Compilation errors (new tsconfig strictness breaks existing solutions)
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execaSync } from 'execa';
import { SYSTEMS_DIR, fileToSlug, slugToDisplayName } from '../reader/index.js';
import { generateManifest, writeManifest } from './audit-solutions.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface LessonVerification {
  lessonSlug: string;
  lessonTitle: string;
  order: number;
  compiles: boolean;
  compileErrors: string;
  tests: TestResult;
  filesProvided: number;
  skipped: boolean;
}

export interface TestResult {
  total: number;
  passed: number;
  failed: number;
}

export interface VerificationReport {
  system: string;
  track: string;
  results: LessonVerification[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    compileFailures: number;
    testFailures: number;
  };
  duration: number;
  timestamp: string;
  manifestPath: string;
}

// ─── Cumulative File Tracker ────────────────────────────────────────

/**
 * Tracks which solution file came from which lesson.
 */
interface FileOrigin {
  path: string;
  currentOwner: string;
  previousOwners: string[];
}

class CumulativeFileTracker {
  private files: Map<string, FileOrigin> = new Map();

  /**
   * Copy solution files from a lesson into the target directory.
   * Newer lessons overwrite older ones for the same file path.
   */
  copySolution(lessonDir: string, lessonSlug: string, targetDir: string): number {
    const solutionDir = path.join(lessonDir, 'solution');
    if (!fs.existsSync(solutionDir)) return 0;

    let count = 0;
    this.copyRecursive(solutionDir, targetDir, lessonSlug, '', () => { count++; });
    return count;
  }

  private copyRecursive(
    src: string, dest: string, lessonSlug: string,
    relative: string, onFile: () => void,
  ): void {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const relPath = relative ? `${relative}/${entry.name}` : entry.name;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, relPath);

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyRecursive(srcPath, destPath, lessonSlug, relPath, onFile);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        // Track origin
        const existing = this.files.get(relPath);
        if (existing) {
          existing.previousOwners.push(existing.currentOwner);
          existing.currentOwner = lessonSlug;
        } else {
          this.files.set(relPath, {
            path: relPath,
            currentOwner: lessonSlug,
            previousOwners: [],
          });
        }

        fs.copyFileSync(srcPath, destPath);
        onFile();
      }
    }
  }

  getFileCount(): number {
    return this.files.size;
  }

  getOrphans(): FileOrigin[] {
    // Files that have changed owners more than 3 times (churn)
    return Array.from(this.files.values()).filter(f => f.previousOwners.length > 2);
  }
}

// ─── Verify Runner ──────────────────────────────────────────────────

/**
 * Run cumulative verification of all lesson solutions.
 */
export async function verifySolutions(systemSlug: string, trackSlug: string): Promise<VerificationReport> {
  const startTime = Date.now();
  const trackDir = path.join(SYSTEMS_DIR(), systemSlug, trackSlug);

  if (!fs.existsSync(trackDir)) {
    throw new Error(`Track not found: ${systemSlug}/${trackSlug}`);
  }

  // Get all lesson directories in order
  const lessonDirs = fs.readdirSync(trackDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Generate and write manifest
  const manifest = generateManifest(systemSlug, trackSlug);
  const manifestPath = writeManifest(systemSlug, trackSlug, manifest);

  // Create temp directory for cumulative verification
  const tmpDir = path.join(
    os.tmpdir(),
    `100x-verify-solutions-${Date.now()}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });

  const tracker = new CumulativeFileTracker();
  const results: LessonVerification[] = [];

  try {
    // Scaffold a minimal project
    await scaffoldMinimalProject(tmpDir, systemSlug, trackSlug);

    // Install dependencies
    console.warn(`  Installing dependencies...`);
    const installResult = execaSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: tmpDir,
      timeout: 120_000,
      reject: false,
      stdio: 'pipe',
    });
    if (installResult.exitCode !== 0) {
      console.warn(`  ⚠️  npm install failed: ${installResult.stderr.slice(0, 200)}`);
    }

    // Verify each lesson cumulatively
    for (const lessonEntry of lessonDirs) {
      const lessonSlug = fileToSlug(lessonEntry.name);
      const lessonDir = path.join(trackDir, lessonEntry.name);
      const lessonMdPath = path.join(lessonDir, 'lesson.md');
      const hasSolution = fs.existsSync(path.join(lessonDir, 'solution'));

      // Get lesson title
      let lessonTitle = slugToDisplayName(lessonSlug);
      if (fs.existsSync(lessonMdPath)) {
        try {
          const raw = fs.readFileSync(lessonMdPath, 'utf-8');
          const titleMatch = raw.match(/^title:\s*(.+)$/m);
          if (titleMatch) lessonTitle = titleMatch[1].replace(/["']/g, '');
        } catch { }
      }

      // Copy solution files (cumulative)
      const filesProvided = tracker.copySolution(lessonDir, lessonSlug, tmpDir);

      // Skip if no solution and no test file
      const testFile = path.join(lessonDir, 'tests', 'behavior.test.ts');
      const hasTests = fs.existsSync(testFile);
      const skipVerification = !hasSolution && !hasTests;

      let compiles = true;
      let compileErrors = '';
      let testResult: TestResult = { total: 0, passed: 0, failed: 0 };

      if (!skipVerification) {
        // Step A: TypeScript compilation check
        try {
          const tscResult = execaSync('npx', ['--no-install', 'tsc', '--noEmit'], {
            cwd: tmpDir,
            timeout: 30_000,
            reject: false,
            stdio: 'pipe',
          });
          compiles = tscResult.exitCode === 0;
          if (!compiles) {
            compileErrors = (tscResult.stderr || tscResult.stdout || '').slice(0, 500);
          }
        } catch (err: any) {
          compiles = false;
          compileErrors = err.message.slice(0, 500);
        }

        // Step B: Copy test file and run vitest
        if (hasTests && compiles) {
          try {
            // Copy test file into temp project
            const testDest = path.join(tmpDir, 'test.spec.ts');
            fs.copyFileSync(testFile, testDest);

            // Run vitest
            const vitestResult = execaSync('npx', ['vitest', 'run', '--reporter', 'json'], {
              cwd: tmpDir,
              timeout: 60_000,
              reject: false,
              stdio: 'pipe',
            });

            testResult = parseVitestOutput(vitestResult.stdout);
          } catch (err: any) {
            testResult = { total: 0, passed: 0, failed: 0 };
          }
        }
      }

      results.push({
        lessonSlug,
        lessonTitle,
        order: lessonDirs.indexOf(lessonEntry) + 1,
        compiles,
        compileErrors,
        tests: testResult,
        filesProvided,
        skipped: skipVerification,
      });
    }

    // Generate manifest after verification
    const finalManifest = generateManifest(systemSlug, trackSlug);
    const finalManifestPath = writeManifest(systemSlug, trackSlug, finalManifest);

    // Compute summary
    const summary = {
      total: results.length,
      passed: results.filter(r => !r.skipped && r.compiles && r.tests.failed === 0).length,
      failed: results.filter(r => !r.skipped && (!r.compiles || r.tests.failed > 0)).length,
      skipped: results.filter(r => r.skipped).length,
      compileFailures: results.filter(r => !r.skipped && !r.compiles).length,
      testFailures: results.filter(r => !r.skipped && r.tests.failed > 0).length,
    };

    return {
      system: systemSlug,
      track: trackSlug,
      results,
      summary,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      manifestPath: finalManifestPath,
    };
  } finally {
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { }
  }
}

// ─── Scaffolding ────────────────────────────────────────────────────

/**
 * Create a minimal TypeScript project for verification.
 */
async function scaffoldMinimalProject(targetDir: string, systemSlug: string, trackSlug: string): Promise<void> {
  // package.json
  const pkg = {
    name: `verify-${systemSlug}-${trackSlug}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'tsc',
    },
    devDependencies: {
      typescript: '^5.4.0',
      '@types/node': '^20.0.0',
      commander: '^12.0.0',
      vitest: '^2.0.0',
    },
  };
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      outDir: './dist',
      rootDir: './src',
    },
    include: ['src/**/*'],
  };
  fs.writeFileSync(path.join(targetDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');

  // Create src directory
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });

  // Create a minimal README
  fs.writeFileSync(path.join(targetDir, 'README.md'), `# ${systemSlug} - ${trackSlug}\n\nAutomated verification project.\n`);
}

// ─── Vitest Output Parser ───────────────────────────────────────────

/**
 * Parse vitest JSON output into test results.
 */
function parseVitestOutput(stdout: string): TestResult {
  try {
    const jsonMatch = stdout.match(/(\{[\s\S]*"testResults"[\s\S]*\})/);
    if (!jsonMatch) {
      // Try alternate vitest JSON format
      const altMatch = stdout.match(/(\{[\s\S]*"numTotalTests"[\s\S]*\})/);
      if (!altMatch) return { total: 0, passed: 0, failed: 0 };

      const data = JSON.parse(altMatch[1]);
      return {
        total: data.numTotalTests || 0,
        passed: data.numPassedTests || 0,
        failed: data.numFailedTests || 0,
      };
    }

    const data = JSON.parse(jsonMatch[0]);
    const fileResults = data.testResults || [];
    let total = 0, passed = 0, failed = 0;

    for (const file of fileResults) {
      const assertions = file.assertionResults || [];
      for (const a of assertions) {
        total++;
        if (a.status === 'passed') passed++;
        else if (a.status === 'failed') failed++;
      }
    }

    return { total, passed, failed };
  } catch {
    return { total: 0, passed: 0, failed: 0 };
  }
}

/**
 * Format the verification report as a human-readable string.
 */
export function formatReport(report: VerificationReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('📋 Solution Verification Report');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`System: ${report.system}  |  Track: ${report.track}`);
  lines.push(`Duration: ${(report.duration / 1000).toFixed(1)}s`);
  lines.push('');

  // Header
  lines.push('  Lesson'.padEnd(45) + 'Compile  Tests    Status');
  lines.push('  ' + '─'.repeat(70));

  for (const r of report.results) {
    const name = `${r.order}. ${r.lessonTitle}`.padEnd(42);
    const compileStatus = r.skipped ? '  ⏭️ ' : r.compiles ? '  ✅  ' : '  ❌  ';
    const testStr = r.skipped ? '  —   ' :
      r.tests.total > 0 ? `${(r.tests.passed + '/' + r.tests.total).padStart(6)}` : '  —   ';

    let status: string;
    if (r.skipped) {
      status = '⏭️ No tests';
    } else if (!r.compiles) {
      status = '❌ COMPILE FAIL';
    } else if (r.tests.failed > 0) {
      status = '❌ TEST FAIL';
    } else {
      status = '✅ PASS';
    }

    lines.push(`  ${name}${compileStatus}${testStr}  ${status}`);
  }

  lines.push('');
  lines.push('  ' + '─'.repeat(70));
  lines.push(`  Total: ${report.summary.total} lessons · ` +
    `${report.summary.passed} passed · ` +
    `${report.summary.failed} failed · ` +
    `${report.summary.skipped} skipped`);
  lines.push(`  Manifest: ${report.manifestPath}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Format the report as JSON for CI consumption.
 */
export function formatReportJson(report: VerificationReport): string {
  return JSON.stringify(report, null, 2);
}

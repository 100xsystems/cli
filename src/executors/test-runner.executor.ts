/**
 * ## TestRunner Executor
 *
 * Runs real behavioral test suites from the curriculum against the user's
 * project code. This is the core of the 3-level validation system's Level 2.
 *
 * Instead of just checking "does file exist", this executor:
 * 1. Copies the user's source code into a temp directory
 * 2. Copies the lesson's test.spec.ts from the curriculum into the temp dir
 * 3. Installs vitest (isolated — no pollution of user's project)
 * 4. Runs npx vitest run --reporter json
 * 5. Parses the JSON output and maps each test to a ValidationResult
 * 6. Cleans up the temp directory
 *
 * Supports multiple frameworks via the `framework` parameter:
 *   - vitest: TypeScript/JavaScript (uses vitest)
 *   - junit: Java (uses Maven/Gradle surefire — planned)
 *   - go-test: Go (uses `go test` — planned)
 *   - cargo-test: Rust (uses `cargo test` — planned)
 *
 * @example
 * validation:
 *   - type: test-runner
 *     test_file: "test.spec.ts"
 *     framework: vitest
 *     timeout: 60000
 *     expected_passes: 6
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { execa, execaSync } from 'execa';
import { randomBytes } from 'crypto';
import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

// ─── Constants ──────────────────────────────────────────────────────

const TEMP_BASE = '/tmp/100x-test-';
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  '.cache', 'coverage', 'target', 'out', '.100x',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs',
]);

// ─── Executor ───────────────────────────────────────────────────────

export class TestRunnerExecutor implements Executor {
  type = 'test-runner';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const framework = (params.framework as string) || 'vitest';
    const testFile = (params.test_file as string);
    const timeout = (params.timeout as number) || 120000;
    const expectedPasses = params.expected_passes as number | undefined;

    if (!testFile) {
      return {
        check: 'test-runner',
        status: 'fail',
        message: 'Missing "test_file" parameter — specify the test file name (e.g., "test.spec.ts")',
        category: 'validation',
      };
    }

    // The test file should live alongside lesson.md in the same lesson folder
    const testFilePath = path.join(ctx.lessonDir, testFile);
    if (!fs.existsSync(testFilePath)) {
      return {
        check: `test-runner:${testFile}`,
        status: 'fail',
        message: `Test file not found in curriculum: ${testFile} (expected at ${testFilePath})`,
        category: 'validation',
        details: `Looking for test file at: ${testFilePath}`,
      };
    }

    switch (framework) {
      case 'vitest':
        return this.runVitest(testFilePath, ctx, { timeout, expectedPasses });
      case 'junit':
        return this.runJUnit(testFilePath, ctx, { timeout, expectedPasses });
      case 'go-test':
        return this.runGoTest(testFilePath, ctx, { timeout, expectedPasses });
      case 'cargo-test':
        return this.runCargoTest(testFilePath, ctx, { timeout, expectedPasses });
      default:
        return {
          check: 'test-runner',
          status: 'fail',
          message: `Unsupported test framework: "${framework}". Supported: vitest, junit, go-test, cargo-test`,
          category: 'validation',
        };
    }
  }

  // ── Vitest Runner (TypeScript/JavaScript) ─────────────────────────

  private async runVitest(
    testFilePath: string,
    ctx: ExecutorContext,
    opts: { timeout: number; expectedPasses?: number },
  ): Promise<ExecutorResult> {
    const tmpDir = await this.createTempDir('vitest');
    let cleanup = true;

    try {
      // Step 1: Copy user's source files into temp dir
      this.copyProjectFiles(ctx.projectDir, tmpDir);

      // Step 2: Copy the test file into temp dir
      const testDest = path.join(tmpDir, 'test.spec.ts');
      fs.copyFileSync(testFilePath, testDest);

      // Step 3: Inject vitest dependency into package.json
      this.ensureDependency(tmpDir, 'vitest', '^3.0.0');

      // Step 4: Create a minimal vitest.config.ts if none exists
      this.ensureVitestConfig(tmpDir);

      // Step 5: Install vitest (fast from npm cache)
      const installResult = await execa('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: tmpDir,
        timeout: opts.timeout,
        reject: false,
        stdio: 'pipe',
      });

      if (installResult.exitCode !== 0) {
        // Try with --legacy-peer-deps if it fails
        const retryResult = await execa('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], {
          cwd: tmpDir,
          timeout: opts.timeout,
          reject: false,
          stdio: 'pipe',
        });
        if (retryResult.exitCode !== 0) {
          return {
            check: 'test-runner:vitest',
            status: 'error',
            message: 'Failed to install dependencies for test execution',
            details: (retryResult.stderr || retryResult.stdout).slice(0, 500),
            category: 'test',
          };
        }
      }

      // Step 6: Run vitest with JSON reporter
      const vitestResult = await execa('npx', ['vitest', 'run', '--reporter', 'json'], {
        cwd: tmpDir,
        timeout: opts.timeout,
        reject: false,
        stdio: 'pipe',
      });

      // Step 7: Parse JSON output
      const stdout = vitestResult.stdout || '';
      const stderr = vitestResult.stderr || '';

      // Vitest JSON reporter outputs JSON on stdout. The output is a JSON object
      // with "testResults" array. If vitest fails to compile, it may print errors.
      // Use a capture group to extract the JSON block safely.
      const jsonMatch = stdout.match(/(\{[\s\S]*"testResults"[\s\S]*\})/);

      if (!jsonMatch) {
        // Vitest might have printed non-JSON output on failure (e.g., compilation errors)
        const allOutput = stdout + '\n' + stderr;
        const failLines = allOutput.split('\n')
          .filter((l: string) => l.includes('FAIL') || l.includes('✗') || l.includes('Error'))
          .slice(0, 10);

        if (failLines.length > 0) {
          return {
            check: 'test-runner:vitest',
            status: 'fail',
            message: 'Tests failed — see details for failure output',
            details: failLines.join('\n').slice(0, 1000),
            category: 'test',
          };
        }

        return {
          check: 'test-runner:vitest',
          status: vitestResult.exitCode === 0 ? 'pass' : 'fail',
          message: vitestResult.exitCode === 0
            ? 'All tests passed'
            : `Tests exited with code ${vitestResult.exitCode} — ensure your implementation meets the lesson requirements`,
          details: (stdout + '\n' + stderr).slice(0, 500),
          category: 'test',
        };
      }

      // Parse the JSON — jsonMatch[0] is the full match (capture group is entire JSON object)
      let vitestOutput: any;
      try {
        vitestOutput = JSON.parse(jsonMatch[0]);
      } catch {
        // JSON was matched by regex but failed to parse — show raw output
        return {
          check: 'test-runner:vitest',
          status: 'error',
          message: 'Failed to parse vitest output as JSON',
          details: stdout.slice(0, 500),
          category: 'test',
        };
      }

      // Vitest JSON reporter outputs testResults as an array of file-level results.
      // Each file result has assertionResults[], which are the individual test cases.
      // vitest uses "passed"/"failed" for assertion status (past tense).
      const fileResults = vitestOutput.testResults || [];
      const assertions: Array<{ status: string; title: string; fullName: string; failureMessages: string[] }> = [];
      for (const file of fileResults) {
        const fileAssertions = file.assertionResults || [];
        for (const a of fileAssertions) {
          assertions.push({
            status: a.status,       // "passed" | "failed" | "pending"
            title: a.title || a.fullName || 'unnamed test',
            fullName: a.fullName || a.title || '',
            failureMessages: a.failureMessages || [],
          });
        }
      }

      const numPassed = assertions.filter((a: any) => a.status === 'passed').length;
      const numFailed = assertions.filter((a: any) => a.status === 'failed').length;
      const totalTests = assertions.length;

      // Check expected passes if specified
      if (opts.expectedPasses !== undefined && numPassed < opts.expectedPasses) {
        return {
          check: 'test-runner:vitest',
          status: 'fail',
          message: `${numPassed}/${opts.expectedPasses} tests passed (expected ${opts.expectedPasses})`,
          details: this.formatAssertionResults(assertions),
          category: 'test',
        };
      }

      if (numFailed > 0) {
        return {
          check: 'test-runner:vitest',
          status: 'fail',
          message: `${numFailed} test(s) failed out of ${totalTests}`,
          details: this.formatAssertionResults(assertions),
          category: 'test',
        };
      }

      return {
        check: 'test-runner:vitest',
        status: 'pass',
        message: `All ${numPassed} test(s) passed`,
        details: totalTests > 0
          ? `Passed: ${numPassed}, Failed: ${numFailed}, Total: ${totalTests}`
          : undefined,
        category: 'test',
      };
    } catch (err: any) {
      if (err.isTimeout) {
        return {
          check: 'test-runner:vitest',
          status: 'fail',
          message: `Test execution timed out after ${opts.timeout}ms`,
          category: 'test',
        };
      }
      return {
        check: 'test-runner:vitest',
        status: 'error',
        message: `Test runner error: ${err.message}`,
        details: err.stderr?.slice(0, 500),
        category: 'test',
      };
    } finally {
      if (cleanup) {
        this.cleanupTempDir(tmpDir);
      }
    }
  }

  // ── JUnit Runner (Java) — Planned ────────────────────────────────

  private async runJUnit(
    _testFilePath: string,
    _ctx: ExecutorContext,
    _opts: { timeout: number; expectedPasses?: number },
  ): Promise<ExecutorResult> {
    return {
      check: 'test-runner:junit',
      status: 'error',
      message: 'JUnit test runner not yet implemented. Coming soon for Java tracks.',
      category: 'test',
    };
  }

  // ── Go Test Runner — Planned ──────────────────────────────────────

  private async runGoTest(
    _testFilePath: string,
    _ctx: ExecutorContext,
    _opts: { timeout: number; expectedPasses?: number },
  ): Promise<ExecutorResult> {
    return {
      check: 'test-runner:go-test',
      status: 'error',
      message: 'Go test runner not yet implemented. Coming soon for Go tracks.',
      category: 'test',
    };
  }

  // ── Cargo Test Runner — Planned ──────────────────────────────────

  private async runCargoTest(
    _testFilePath: string,
    _ctx: ExecutorContext,
    _opts: { timeout: number; expectedPasses?: number },
  ): Promise<ExecutorResult> {
    return {
      check: 'test-runner:cargo-test',
      status: 'error',
      message: 'Cargo test runner not yet implemented. Coming soon for Rust tracks.',
      category: 'test',
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async createTempDir(label: string): Promise<string> {
    const suffix = randomBytes(4).toString('hex');
    const tmpDir = `${TEMP_BASE}${label}-${suffix}`;
    await fs.promises.mkdir(tmpDir, { recursive: true });
    return tmpDir;
  }

  /**
   * Copy user's source files into the temp directory.
   * Only copies source files — excludes node_modules, .git, dist, etc.
   */
  private copyProjectFiles(projectDir: string, tmpDir: string): void {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const srcPath = path.join(projectDir, entry.name);
      const destPath = path.join(tmpDir, entry.name);

      try {
        if (entry.isDirectory()) {
          this.copyDirRecursive(srcPath, destPath);
        } else if (this.isSourceFile(entry.name)) {
          fs.copyFileSync(srcPath, destPath);
        }
      } catch {
        // Skip files we can't read
      }
    }
  }

  private copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      try {
        if (entry.isDirectory()) {
          this.copyDirRecursive(srcPath, destPath);
        } else if (this.isSourceFile(entry.name)) {
          fs.copyFileSync(srcPath, destPath);
        }
      } catch {
        // Skip
      }
    }
  }

  private isSourceFile(name: string): boolean {
    const ext = path.extname(name);
    return SOURCE_EXTENSIONS.has(ext);
  }

  /**
   * Ensure vitest is listed as a devDependency in the temp package.json.
   */
  private ensureDependency(tmpDir: string, depName: string, version: string): void {
    const pkgPath = path.join(tmpDir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      // Create a minimal package.json
      fs.writeFileSync(pkgPath, JSON.stringify({
        name: '100x-test',
        type: 'module',
        private: true,
        devDependencies: {},
      }, null, 2));
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (!pkg.devDependencies) pkg.devDependencies = {};
      if (!pkg.devDependencies[depName]) {
        pkg.devDependencies[depName] = version;
      }
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    } catch {
      // If we can't parse package.json, just write a minimal one
      fs.writeFileSync(pkgPath, JSON.stringify({
        name: '100x-test',
        type: 'module',
        private: true,
        devDependencies: {
          [depName]: version,
        },
      }, null, 2));
    }
  }

  /**
   * Create a vitest.config.ts if none exists, so vitest can resolve TS imports.
   */
  private ensureVitestConfig(tmpDir: string): void {
    const configPath = path.join(tmpDir, 'vitest.config.ts');
    if (fs.existsSync(configPath)) return;

    // Only create if the user has tsconfig.json
    if (!fs.existsSync(path.join(tmpDir, 'tsconfig.json'))) return;

    fs.writeFileSync(configPath, `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n    globals: true,\n    environment: 'node',\n    include: ['**/*.spec.ts', '**/*.test.ts'],\n  },\n});\n`);
  }

  /**
   * Format vitest assertion-level results into readable text.
   * Handles vitest's actual JSON format:
   *   - assertion.status: "passed" | "failed" | "pending"
   *   - assertion.title: individual test name
   *   - assertion.failureMessages: string[] of error details
   *
   * Shows up to 20 individual tests, each with pass/fail icon and
   * first line of failure message for failed tests.
   */
  private formatAssertionResults(assertions: Array<{ status: string; title: string; fullName: string; failureMessages: string[] }>): string {
    if (!assertions || assertions.length === 0) return 'No test results';

    const lines: string[] = [];
    for (const a of assertions.slice(0, 20)) {
      const icon = a.status === 'passed' ? '✓' : a.status === 'failed' ? '✗' : '?';
      lines.push(`  ${icon} ${a.title}`);
      if (a.status === 'failed' && a.failureMessages && a.failureMessages.length > 0) {
        // Show first failure message, truncated and indented
        const msg = a.failureMessages[0].split('\n')[0].slice(0, 200);
        lines.push(`     ${msg}`);
      }
    }
    if (assertions.length > 20) {
      lines.push(`  ... and ${assertions.length - 20} more`);
    }
    return lines.join('\n');
  }

  /**
   * Clean up the temp directory.
   */
  private cleanupTempDir(tmpDir: string): void {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

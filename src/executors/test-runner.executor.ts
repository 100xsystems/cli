/**
 * ## TestRunner Executor
 *
 * Runs real behavioral test suites from the curriculum against the user's
 * project code. This is the core of the 3-level validation system's Level 2.
 *
 * Instead of just checking "does file exist", this executor:
 * 1. Copies the user's source code into a temp directory
 * 2. Copies the lesson's behavior.test.ts from the curriculum into the temp dir
 * 3. Installs @100xsystems/test-suite-{framework} (isolated — no pollution of user's project)
 * 4. Runs npx vitest run --reporter json
 * 5. Parses the JSON output and maps each test to a ValidationResult
 * 6. Cleans up the temp directory
 *
 * The test-suite packages provide shared test helpers and re-export vitest,
 * so lesson test files don't need to import vitest / fs / path / child_process directly.
 *
 * ## Auto-detect expected_passes
 *
 * The `expected_passes` field in frontmatter is now OPTIONAL. If omitted,
 * the executor parses the test file to count `it()` and `test()` blocks
 * automatically. If specified, it's used as the minimum required passes.
 * This eliminates manual count drift as tests are added/removed.
 *
 * ## npm dependency caching
 *
 * To avoid `npm install` on every validation run, the executor maintains
 * a warm cache at `~/.cache/100xsystems/test-node-modules/`. It creates a
 * snapshot of the dependency manifest, then symlinks from cache when possible.
 *
 * ## Temp dir cleanup
 *
 * All created temp directories are tracked in a registry file at
 * `~/.cache/100xsystems/test-tmp-dirs.json`. On executor startup, stale
 * entries (older than 1 hour) are cleaned up automatically.
 *
 * Supports multiple frameworks via the `framework` parameter:
 *   - vitest: TypeScript/JavaScript (uses @100xsystems/test-suite-typescript)
 *   - junit: Java (uses Maven/Gradle surefire — planned)
 *   - go-test: Go (uses `go test` — planned)
 *   - cargo-test: Rust (uses `cargo test` — planned)
 *
 * @example
 * validation:
 *   - type: test-runner
 *     test_file: "tests/behavior.test.ts"
 *     framework: vitest
 *     timeout: 60000
 *     # expected_passes is AUTO-DETECTED from the test file
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execa, execaSync } from 'execa';
import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

// ─── Constants ──────────────────────────────────────────────────────

const TEMP_BASE = '/tmp/100x-test-';
const XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
const CACHE_DIR = path.join(XDG_CACHE_HOME, '100xsystems');
const TMP_DIR_REGISTRY = path.join(CACHE_DIR, 'test-tmp-dirs.json');
const NPM_CACHE_DIR = path.join(CACHE_DIR, 'test-node-modules');

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  '.cache', 'coverage', 'target', 'out', '.100x',
]);

// Java extensions are added alongside TypeScript for JUnit test execution
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs',
  '.java', '.xml', '.yml', '.yaml', '.properties',
]);

// ─── Executor ───────────────────────────────────────────────────────

export class TestRunnerExecutor implements Executor {
  type = 'test-runner';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    // Clean up stale temp dirs from previous runs
    this.cleanupStaleTempDirs();

    const framework = (params.framework as string) || 'vitest';
    const testFile = (params.test_file as string);
    const timeout = (params.timeout as number) || 120000;
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

    // Auto-detect expected_passes from the test file if not specified in frontmatter
    const expectedPasses = params.expected_passes !== undefined
      ? (params.expected_passes as number)
      : this.countTestCases(testFilePath);

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
    this.registerTempDir(tmpDir);
    let cleanup = true;

    try {
      // Step 1: Copy user's source files into temp dir
      this.copyProjectFiles(ctx.projectDir, tmpDir);

      // Step 2: Copy the test file into temp dir
      const testDest = path.join(tmpDir, 'test.spec.ts');
      fs.copyFileSync(testFilePath, testDest);

      // Step 3: Resolve file: references in package.json to absolute paths
      // The user's package.json may have `file:../../../test-suite-typescript` references.
      // These are relative to the original project dir, but when copied to the temp dir,
      // the relative paths no longer resolve. We rewrite them to absolute paths using
      // ctx.projectDir as the base so npm install works correctly.
      this.resolveFileReferences(tmpDir, ctx.projectDir);

      // Step 3b: Resolve test-suite-typescript from local filesystem
      // @100xsystems/test-suite-typescript is NOT published on npm. It's a local package
      // bundled with the CLI. We resolve it relative to the CLI's own location.
      // From cli/dist/executors/test-runner.executor.js → ../../../test-suite-typescript
      this.resolveLocalTestSuite(tmpDir);

      // Step 3c: Inject test-suite dependency into package.json (only if not already resolved)
      this.ensureDependency(tmpDir, '@100xsystems/test-suite-typescript', '^0.1.1');

      // Step 4: Create a minimal vitest.config.ts if none exists
      this.ensureVitestConfig(tmpDir);

      // Step 5: Install dependencies — use cached node_modules when possible
      const installResult = await this.installDependenciesCached(tmpDir, opts.timeout);

      if (!installResult) {
        return {
          check: 'test-runner:vitest',
          status: 'error',
          message: 'Failed to install dependencies for test execution',
          category: 'test',
        };
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

      // Check expected passes (auto-detected or from frontmatter)
      if (numPassed < (opts.expectedPasses ?? totalTests)) {
        return {
          check: 'test-runner:vitest',
          status: 'fail',
          message: `${numPassed}/${opts.expectedPasses ?? totalTests} tests passed (expected ${opts.expectedPasses ?? totalTests})`,
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

  // ── JUnit Runner (Java) ──────────────────────────────────────────
  //
  // Workflow:
  //   1. Copy user's Java source files into temp dir
  //   2. Copy the lesson's JUnit test file into src/test/java/
  //   3. Copy BaseTest.java + FileHelper.java + BuildHelper.java
  //      directly into the test source tree (no external dependency needed)
  //   4. Inject JUnit 5 dependencies into the user's pom.xml
  //   5. Run `mvn test`
  //   6. Parse surefire XML reports for per-test results
  //
  // This approach does NOT require GitHub Packages authentication —
  // the helper source files are compiled inline as part of the user's
  // project. This keeps the validation self-contained and zero-config.

  private async runJUnit(
    testFilePath: string,
    ctx: ExecutorContext,
    opts: { timeout: number; expectedPasses?: number },
  ): Promise<ExecutorResult> {
    const tmpDir = await this.createTempDir('junit');
    this.registerTempDir(tmpDir);
    let cleanup = true;

    try {
      // Step 1: Copy user's Java source files into temp dir
      this.copyJavaProject(ctx.projectDir, tmpDir);

      // Step 2: Create src/test/java directory and copy lesson test file
      const testJavaDir = path.join(tmpDir, 'src', 'test', 'java');
      fs.mkdirSync(testJavaDir, { recursive: true });

      // Copy the lesson's JUnit test file into the test source tree
      const testFileName = path.basename(testFilePath);
      const testDest = path.join(testJavaDir, testFileName);
      fs.copyFileSync(testFilePath, testDest);

      // Step 3: Copy the test helper source files (BaseTest, FileHelper, BuildHelper)
      // into the test source tree so they compile alongside the lesson test.
      // These are the "test-suite-java" helpers provided inline — no Maven dependency needed.
      await this.copyTestSuiteJavaHelpers(testJavaDir);

      // Step 4: Inject JUnit 5 dependencies into the user's pom.xml
      this.ensureMavenDependencies(tmpDir);

      // Step 5: Run mvn test
      const mvnResult = await execa('mvn', ['test', '-q'], {
        cwd: tmpDir,
        timeout: opts.timeout,
        reject: false,
        stdio: 'pipe',
      });

      const stdout = mvnResult.stdout || '';
      const stderr = mvnResult.stderr || '';

      // Step 6: Parse surefire XML reports for per-test results
      const reportsDir = path.join(tmpDir, 'target', 'surefire-reports');
      const assertionResults = this.parseSurefireReports(reportsDir);

      const numPassed = assertionResults.filter((a: any) => a.status === 'passed').length;
      const numFailed = assertionResults.filter((a: any) => a.status === 'failed').length;
      const totalTests = assertionResults.length;

      if (totalTests === 0) {
        // No surefire reports — fall back to exit code
        if (mvnResult.exitCode === 0) {
          return {
            check: 'test-runner:junit',
            status: 'pass',
            message: 'All tests passed',
            category: 'test',
          };
        }

        // Extract failure info from Maven output
        const failLines = (stdout + '\n' + stderr).split('\n')
          .filter((l: string) => l.includes('FAIL') || l.includes('ERROR') || l.includes('Tests run:'))
          .slice(0, 15);

        return {
          check: 'test-runner:junit',
          status: 'fail',
          message: `Maven tests failed (exit code ${mvnResult.exitCode})`,
          details: failLines.join('\n').slice(0, 1000),
          category: 'test',
        };
      }

      // Check expected passes
      if (opts.expectedPasses !== undefined && numPassed < opts.expectedPasses) {
        return {
          check: 'test-runner:junit',
          status: 'fail',
          message: `${numPassed}/${opts.expectedPasses} tests passed (expected ${opts.expectedPasses})`,
          details: this.formatJUnitResults(assertionResults),
          category: 'test',
        };
      }

      if (numFailed > 0) {
        return {
          check: 'test-runner:junit',
          status: 'fail',
          message: `${numFailed} test(s) failed out of ${totalTests}`,
          details: this.formatJUnitResults(assertionResults),
          category: 'test',
        };
      }

      return {
        check: 'test-runner:junit',
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
          check: 'test-runner:junit',
          status: 'fail',
          message: `Test execution timed out after ${opts.timeout}ms`,
          category: 'test',
        };
      }
      return {
        check: 'test-runner:junit',
        status: 'error',
        message: `JUnit test runner error: ${err.message}`,
        details: err.stderr?.slice(0, 500),
        category: 'test',
      };
    } finally {
      if (cleanup) {
        this.cleanupTempDir(tmpDir);
      }
    }
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

  /**
   * Count test cases in a test file by parsing it() and test() call expressions.
   * Handles both `it('name', ...)` and `test('name', ...)` patterns, including
   * escaped quotes, template literals, and multi-line expressions.
   *
   * This is used to auto-detect expected_passes when the frontmatter doesn't
   * explicitly set it. It counts top-level it/test calls, including those
   * inside describe blocks.
   */
  private countTestCases(testFilePath: string): number {
    try {
      const content = fs.readFileSync(testFilePath, 'utf-8');
      // Match it('...') or it("...") or test('...') or test("...")
      // Handles escaped quotes, template literals, nested parentheses
      const regex = /\b(?:it|test)\s*\(\s*(?:`[^`]*`|'[^']*'|"[^"]*"|[^,)]+)/g;
      const matches = content.match(regex);
      return matches ? matches.length : 0;
    } catch {
      return 0;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async createTempDir(label: string): Promise<string> {
    const suffix = crypto.randomBytes(4).toString('hex');
    const tmpDir = `${TEMP_BASE}${label}-${suffix}`;
    await fs.promises.mkdir(tmpDir, { recursive: true });
    return tmpDir;
  }

  /**
   * Register a temp directory in the persistent registry so it can be
   * cleaned up if the process is killed before cleanup runs.
   */
  private registerTempDir(tmpDir: string): void {
    try {
      let registry: Record<string, number> = {};
      if (fs.existsSync(TMP_DIR_REGISTRY)) {
        try {
          registry = JSON.parse(fs.readFileSync(TMP_DIR_REGISTRY, 'utf-8'));
        } catch {
          registry = {};
        }
      }
      registry[tmpDir] = Date.now();
      fs.mkdirSync(path.dirname(TMP_DIR_REGISTRY), { recursive: true });
      fs.writeFileSync(TMP_DIR_REGISTRY, JSON.stringify(registry, null, 2));
    } catch {
      // Best-effort tracking
    }
  }

  /**
   * Clean up stale temp directories from the registry that are older than
   * the specified age (default: 1 hour). This runs on executor startup to
   * prevent /tmp/100x-test-* accumulation from killed processes.
   */
  private cleanupStaleTempDirs(maxAgeMs = 3_600_000): void {
    try {
      if (!fs.existsSync(TMP_DIR_REGISTRY)) return;
      const registry: Record<string, number> = JSON.parse(
        fs.readFileSync(TMP_DIR_REGISTRY, 'utf-8')
      );
      const now = Date.now();
      const updated: Record<string, number> = {};
      for (const [dir, timestamp] of Object.entries(registry)) {
        if (now - timestamp > maxAgeMs) {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            // Already cleaned up or permission denied
          }
        } else {
          updated[dir] = timestamp;
        }
      }
      fs.writeFileSync(TMP_DIR_REGISTRY, JSON.stringify(updated, null, 2));
    } catch {
      // Best-effort cleanup
    }
  }

  /**
   * Install npm dependencies with caching.
   *
   * Strategy: maintain a warm node_modules cache at NPM_CACHE_DIR. On each
   * run, create a hash of the package.json dependencies, and if a matching
   * cached node_modules exists, symlink/copy it. This avoids 30-60s npm
   * install on every validation.
   *
   * Returns true if install succeeded, false otherwise.
   */
  private async installDependenciesCached(tmpDir: string, timeout: number): Promise<boolean> {
    // Compute a hash of the dependency manifest
    const pkgPath = path.join(tmpDir, 'package.json');
    let depsHash = 'no-deps';
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = JSON.stringify({
        dependencies: pkg.dependencies || {},
        devDependencies: pkg.devDependencies || {},
      });
      depsHash = crypto.createHash('md5').update(deps).digest('hex').slice(0, 12);
    } catch {
      // No package.json — nothing to install
      return true;
    }

    const cacheTarget = path.join(NPM_CACHE_DIR, depsHash);
    const nodeModulesDir = path.join(tmpDir, 'node_modules');

    // Check if we have a cached version
    if (fs.existsSync(cacheTarget)) {
      try {
        // Use symlink for speed (works on macOS/Linux)
        fs.symlinkSync(cacheTarget, nodeModulesDir, 'dir');
        return true;
      } catch {
        // Symlink failed (e.g., cross-device on some systems), fall through to install
      }
    }

    // No cache hit — run npm install
    const installResult = await execa('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: tmpDir,
      timeout,
      reject: false,
      stdio: 'pipe',
    });

    if (installResult.exitCode === 0) {
      // Cache the result
      try {
        fs.mkdirSync(NPM_CACHE_DIR, { recursive: true });
        // Copy installed node_modules to cache (can't move — install created it)
        execaSync('cp', ['-r', nodeModulesDir, cacheTarget], { timeout: 30_000 });
      } catch {
        // Caching is best-effort
      }
      return true;
    }

    // Try with --legacy-peer-deps
    const retryResult = await execa('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], {
      cwd: tmpDir,
      timeout,
      reject: false,
      stdio: 'pipe',
    });

    if (retryResult.exitCode === 0) {
      try {
        fs.mkdirSync(NPM_CACHE_DIR, { recursive: true });
        execaSync('cp', ['-r', nodeModulesDir, cacheTarget], { timeout: 30_000 });
      } catch {
        // Best-effort
      }
      return true;
    }

    return false;
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

  // ── Java-Specific Helpers ────────────────────────────────────────

  /**
   * Copy user's Java Maven project files into the temp directory.
   * Includes src/main/java/, pom.xml, and other essential config files.
   * Excludes target/, .git, node_modules, etc.
   */
  private copyJavaProject(projectDir: string, tmpDir: string): void {
    // Copy pom.xml
    const pomPath = path.join(projectDir, 'pom.xml');
    if (fs.existsSync(pomPath)) {
      fs.copyFileSync(pomPath, path.join(tmpDir, 'pom.xml'));
    }

    // Copy src/main/java/ (the Java source tree)
    const srcMainJava = path.join(projectDir, 'src', 'main', 'java');
    if (fs.existsSync(srcMainJava)) {
      const destMainJava = path.join(tmpDir, 'src', 'main', 'java');
      fs.mkdirSync(destMainJava, { recursive: true });
      this.copyDirRecursive(srcMainJava, destMainJava);
    }

    // Copy src/main/resources/
    const srcMainResources = path.join(projectDir, 'src', 'main', 'resources');
    if (fs.existsSync(srcMainResources)) {
      const destMainResources = path.join(tmpDir, 'src', 'main', 'resources');
      fs.mkdirSync(destMainResources, { recursive: true });
      this.copyDirRecursive(srcMainResources, destMainResources);
    }

    // Copy other config files at root level
    for (const cfg of ['.mvn', 'mvnw', 'mvnw.cmd', 'checkstyle.xml', 'settings.xml']) {
      const cfgPath = path.join(projectDir, cfg);
      if (fs.existsSync(cfgPath)) {
        try {
          if (fs.statSync(cfgPath).isDirectory()) {
            this.copyDirRecursive(cfgPath, path.join(tmpDir, cfg));
          } else {
            fs.copyFileSync(cfgPath, path.join(tmpDir, cfg));
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  /**
   * Copy the test-suite-java helper source files into the temp test tree.
   * These are the inline Java equivalents of the @100xsystems/test-suite-java
   * package — BaseTest.java, FileHelper.java, BuildHelper.java.
   *
   * The source files live alongside the test-runner executor in the CLI
   * distribution. They are compiled inline as part of the user's project,
   * so no external Maven dependency or GitHub Packages auth is needed.
   */
  private async copyTestSuiteJavaHelpers(testJavaDir: string): Promise<void> {
    // The helpers are bundled with the CLI in a templates/java-test-helpers/ directory
    const helpersDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates', 'java-test-helpers');

    if (fs.existsSync(helpersDir)) {
      this.copyDirRecursive(helpersDir, testJavaDir);
      return;
    }

    // If templates aren't bundled, warn so the user gets a clear error message
    // instead of a cryptic "cannot find symbol: BaseTest" from javac.
    console.warn(`[100xsystems] Java test helpers not found at ${helpersDir}. ` +
      `Ensure the CLI is properly built (npm run build) to bundle the templates.`);
  }

  /**
   * Ensure JUnit 5 and surefire plugin are in the user's pom.xml.
   * Merges JUnit 5 into the EXISTING <dependencies> section if present,
   * or creates a new one if the pom has none. Same for <build>/<plugins>.
   * This avoids creating duplicate sections which Maven would reject.
   */
  private ensureMavenDependencies(tmpDir: string): void {
    const pomPath = path.join(tmpDir, 'pom.xml');
    if (!fs.existsSync(pomPath)) {
      // Create a minimal pom.xml
      fs.writeFileSync(pomPath, `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.100xsystems</groupId>
    <artifactId>student-project</artifactId>
    <version>1.0.0</version>
    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>
</project>
`);
    }

    try {
      let pom = fs.readFileSync(pomPath, 'utf-8');

      // Inject JUnit 5 dependency into the EXISTING <dependencies> section
      if (!pom.includes('junit-jupiter')) {
        const junitEntry = `
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>5.11.0</version>
            <scope>test</scope>
        </dependency>`;

        // Check if the pom already has a <dependencies> block
        const depsMatch = pom.match(/<dependencies>[\s\S]*?<\/dependencies>/);
        if (depsMatch && depsMatch.index !== undefined) {
          // Merge into existing <dependencies> block — insert before </dependencies>
          pom = pom.slice(0, depsMatch.index + depsMatch[0].lastIndexOf('</dependencies>'))
            + junitEntry
            + pom.slice(depsMatch.index + depsMatch[0].lastIndexOf('</dependencies>'));
        } else {
          // No existing <dependencies> — create one before </project>
          const newDepsBlock = `
    <dependencies>${junitEntry}
    </dependencies>`;
          pom = pom.replace('</project>', newDepsBlock + '\n</project>');
        }
      }

      // Ensure surefire plugin is configured — merge into existing <plugins>
      if (!pom.includes('maven-surefire-plugin')) {
        const surefireEntry = `
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.2.5</version>
                <configuration>
                    <includes>
                        <include>**/*Test.java</include>
                        <include>**/*Tests.java</include>
                    </includes>
                </configuration>
            </plugin>`;

        const pluginsMatch = pom.match(/<plugins>[\s\S]*?<\/plugins>/);
        if (pluginsMatch && pluginsMatch.index !== undefined) {
          // Merge into existing <plugins> block
          pom = pom.slice(0, pluginsMatch.index + pluginsMatch[0].lastIndexOf('</plugins>'))
            + surefireEntry
            + pom.slice(pluginsMatch.index + pluginsMatch[0].lastIndexOf('</plugins>'));
        } else if (pom.includes('<build>')) {
          // Has <build> but no <plugins> — create <plugins> inside <build>
          const newPluginsBlock = `
        <plugins>${surefireEntry}
        </plugins>`;
          pom = pom.replace('</build>', newPluginsBlock + '\n    </build>');
        } else {
          // No <build> section — create one before </project>
          const newBuildBlock = `
    <build>
        <plugins>${surefireEntry}
        </plugins>
    </build>`;
          pom = pom.replace('</project>', newBuildBlock + '\n</project>');
        }
      }

      fs.writeFileSync(pomPath, pom, 'utf-8');
    } catch {
      // If we can't modify pom.xml, mvn test will fail with a clear error
    }
  }

  /**
   * Parse Maven surefire XML reports to extract per-test results.
   * Surefire generates one XML file per test class in target/surefire-reports/.
   * Format:
   *   <testsuite tests="6" failures="0" errors="0" skipped="0">
   *     <testcase name="testMethod" classname="com.example.Test" time="0.123"/>
   *     <testcase name="testFail" classname="com.example.Test" time="0.456">
   *       <failure message="expected X but got Y" type="AssertionError">
   *         stacktrace...
   *       </failure>
   *     </testcase>
   *   </testsuite>
   */
  private parseSurefireReports(reportsDir: string): Array<{ status: string; title: string; failureMessages: string[] }> {
    const assertions: Array<{ status: string; title: string; failureMessages: string[] }> = [];

    if (!fs.existsSync(reportsDir)) return assertions;

    try {
      const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.xml'));

      for (const file of files) {
        const content = fs.readFileSync(path.join(reportsDir, file), 'utf-8');

        // Extract each testcase element using regex
        const testCaseRegex = /<testcase\s+[^>]*name="([^"]+)"[^>]*>[\s\S]*?<\/testcase>/g;
        let match: RegExpExecArray | null;

        while ((match = testCaseRegex.exec(content)) !== null) {
          const testCaseXml = match[0];
          const testName = match[1];
          const fullName = testName;

          // Check for failure or error elements
          const hasFailure = /<failure\s/.test(testCaseXml);
          const hasError = /<error\s/.test(testCaseXml);

          if (hasFailure || hasError) {
            // Extract failure messages
            const failureMsgs: string[] = [];
            const failureRegex = /<failure[^>]*message="([^"]*)"[^>]*>/g;
            const errorRegex = /<error[^>]*message="([^"]*)"[^>]*>/g;
            let fm: RegExpExecArray | null;
            while ((fm = failureRegex.exec(testCaseXml)) !== null) {
              failureMsgs.push(fm[1]);
            }
            while ((fm = errorRegex.exec(testCaseXml)) !== null) {
              failureMsgs.push(fm[1]);
            }

            assertions.push({
              status: 'failed',
              title: fullName,
              failureMessages: failureMsgs.length > 0 ? failureMsgs : [`${hasFailure ? 'Assertion' : 'Error'} in ${fullName}`],
            });
          } else {
            assertions.push({
              status: 'passed',
              title: fullName,
              failureMessages: [],
            });
          }
        }
      }
    } catch {
      // If parsing fails, return empty — fallback to exit code
    }

    return assertions;
  }

  /**
   * Format JUnit assertion results for display.
   * Similar to formatAssertionResults for vitest.
   */
  private formatJUnitResults(assertions: Array<{ status: string; title: string; failureMessages: string[] }>): string {
    if (!assertions || assertions.length === 0) return 'No test results';

    const lines: string[] = [];
    for (const a of assertions.slice(0, 20)) {
      const icon = a.status === 'passed' ? '✓' : a.status === 'failed' ? '✗' : '?';
      // Simplify title: "className.testMethod" → "testMethod"
      const shortName = a.title.includes('.') ? a.title.split('.').slice(-1)[0] : a.title;
      lines.push(`  ${icon} ${shortName}`);
      if (a.status === 'failed' && a.failureMessages && a.failureMessages.length > 0) {
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
   * Resolve the local @100xsystems/test-suite-typescript package and add it
   * as a file: dependency. This avoids needing the package on npm.
   *
   * The test-suite is bundled alongside the CLI in the monorepo structure:
   *   100xsystems/
   *     cli/
   *       dist/executors/test-runner.executor.js
   *     test-suite-typescript/
   *       package.json
   *
   * From the compiled JS file (cli/dist/executors/), the test-suite is at
   * ../../../test-suite-typescript relative to the executor file itself.
   *
   * This is called BEFORE ensureDependency(), so if we resolve successfully,
   * ensureDependency() will see the dep already exists and skip adding the npm version.
   */
  private resolveLocalTestSuite(tmpDir: string): void {
    try {
      // Find the CLI's own location using import.meta.url
      // In dev mode (npm link / tsx): cli/dist/executors/test-runner.executor.js
      // In production (npm -g): depends on install layout
      const executorUrl = new URL(import.meta.url);
      const executorPath = executorUrl.pathname;
      const executorDir = path.dirname(executorPath);

      // Try relative path from executor dir to test-suite
      // cli/dist/executors/ -> ../../../test-suite-typescript
      const possiblePaths = [
        path.resolve(executorDir, '..', '..', '..', 'test-suite-typescript'),
        // If CLI is installed via npm link, try absolute path from the monorepo structure
        path.resolve(executorDir, '..', '..', '..', '..', '..', 'test-suite-typescript'),
      ];

      let testSuitePath: string | null = null;
      for (const candidate of possiblePaths) {
        const pkgJson = path.join(candidate, 'package.json');
        if (fs.existsSync(pkgJson)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
            if (pkg.name === '@100xsystems/test-suite-typescript') {
              testSuitePath = candidate;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      if (!testSuitePath) {
        console.warn('[100xsystems] Could not find @100xsystems/test-suite-typescript locally');
        return;
      }

      // Add as file: dependency to temp package.json
      const pkgPath = path.join(tmpDir, 'package.json');
      if (!fs.existsSync(pkgPath)) return;

      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (!pkg.devDependencies) pkg.devDependencies = {};
      pkg.devDependencies['@100xsystems/test-suite-typescript'] = `file:${testSuitePath}`;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

      console.warn(`[100xsystems] Resolved test-suite from: ${testSuitePath}`);
    } catch (err: any) {
      console.warn(`[100xsystems] Failed to resolve local test-suite: ${err.message}`);
    }
  }

  /**
   * Resolve all `file:` references in the temp package.json to absolute paths.
   * This ensures local packages like @100xsystems/test-suite-typescript (referenced
   * via `file:` relative to the project dir) can be found from the temp directory.
   *
   * @param tmpDir - The temp directory where the user's package.json was copied
   * @param projectDir - The original project directory (used as base for resolving relative paths)
   */
  private resolveFileReferences(tmpDir: string, projectDir: string): void {
    const pkgPath = path.join(tmpDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      let modified = false;

      const resolveDeps = (deps: Record<string, string> | undefined) => {
        if (!deps) return;
        for (const [name, version] of Object.entries(deps)) {
          if (typeof version === 'string' && version.startsWith('file:')) {
            const relativePath = version.slice(5); // strip 'file:' prefix
            const absolutePath = path.resolve(projectDir, relativePath);
            deps[name] = `file:${absolutePath}`;
            modified = true;
          }
        }
      };

      resolveDeps(pkg.dependencies);
      resolveDeps(pkg.devDependencies);

      if (modified) {
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      }
    } catch {
      // Best-effort — if we can't parse package.json, npm install will fail with a clear error
    }
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
      // Only add the dependency if it doesn't already exist.
      // resolveFileReferences() already handles converting file: references to absolute paths,
      // so if the dependency exists as a resolved file: path, we should NOT overwrite it.
      // If the dep truly doesn't exist, fall back to the npm version as a safety net.
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

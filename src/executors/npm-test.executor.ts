/**
 * ## NpmTest Executor
 *
 * Runs npm test (or a specified npm script) in the user's project.
 * Validates that tests pass successfully.
 *
 * @example
 * validation:
 *   - type: npm-test
 *     script: "test"         # default
 *     timeout: 60000         # 60 seconds
 *     expected_passes: 5     # optional minimum test count
 *
 * @packageDocumentation
 */

import { execa } from 'execa';
import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

export class NpmTestExecutor implements Executor {
  type = 'npm-test';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const script = (params.script as string) || 'test';
    const timeout = (params.timeout as number) || 60000;

    try {
      const result = await execa('npm', ['run', script], {
        cwd: ctx.projectDir,
        timeout,
        reject: false,
        stdio: 'pipe',
      });

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';

      if (result.exitCode === 0) {
        // Check expected number of tests if specified
        const expectedPasses = params.expected_passes as number | undefined;
        if (expectedPasses !== undefined) {
          const testMatch = stdout.match(/(\d+)\s+passing/);
          const actualPasses = testMatch ? parseInt(testMatch[1], 10) : 0;
          const testMatch2 = stdout.match(/(\d+)\s+tests?\s+passed/);
          const actualPasses2 = testMatch2 ? parseInt(testMatch2[1], 10) : 0;
          const totalPasses = Math.max(actualPasses, actualPasses2);

          if (totalPasses < expectedPasses) {
            return {
              check: `npm:${script}`,
              status: 'warn',
              message: `Tests passed (exit 0) but only ${totalPasses} passing, expected ${expectedPasses}`,
              details: stdout.slice(0, 500),
              category: 'test',
            };
          }
        }

        return {
          check: `npm:${script}`,
          status: 'pass',
          message: `npm run ${script} passed (exit 0)`,
          details: stdout.slice(0, 300),
          category: 'test',
        };
      }

      // Extract failure summary
      const failLines = stdout
        .split('\n')
        .filter((line: string) => line.includes('failing') || line.includes('FAIL') || line.includes('✗'))
        .slice(0, 5);

      return {
        check: `npm:${script}`,
        status: 'fail',
        message: `npm run ${script} failed with exit code ${result.exitCode}`,
        details: failLines.length > 0
          ? failLines.join('\n')
          : stderr.slice(0, 300),
        category: 'test',
      };
    } catch (err: any) {
      if (err.isTimeout) {
        return {
          check: `npm:${script}`,
          status: 'fail',
          message: `npm run ${script} timed out after ${timeout}ms`,
          category: 'test',
        };
      }
      return {
        check: `npm:${script}`,
        status: 'error',
        message: `Failed to run npm run ${script}: ${err.message}`,
        category: 'test',
      };
    }
  }
}

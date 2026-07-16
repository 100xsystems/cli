/**
 * ## CliCommand Executor
 *
 * Runs an arbitrary CLI command in the project directory and checks its exit code.
 * Useful for running language-specific build tools, linters, or custom scripts.
 *
 * @example
 * validation:
 *   - type: cli-command
 *     command: "mvn compile"
 *     expect_exit_code: 0
 *     timeout: 120000
 *
 *   - type: cli-command
 *     command: "cargo check"
 *     expect_exit_code: 0
 *
 * @packageDocumentation
 */

import { execa } from 'execa';
import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

export class CliCommandExecutor implements Executor {
  type = 'cli-command';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const command = params.command as string;
    if (!command) {
      return {
        check: 'cli-command',
        status: 'fail',
        message: 'Missing "command" parameter in validator config',
        category: 'validation',
      };
    }

    const timeout = (params.timeout as number) || 60000;
    const expectExitCode = (params.expect_exit_code as number) ?? 0;
    const description = (params.description as string) || command;

    // Split command into program and args
    const parts = command.split(/\s+/);
    const program = parts[0];
    const args = parts.slice(1);

    try {
      const result = await execa(program, args, {
        cwd: ctx.projectDir,
        timeout,
        reject: false,
        stdio: 'pipe',
        shell: true,
      });

      if (result.exitCode === expectExitCode) {
        return {
          check: `cmd:${description}`,
          status: 'pass',
          message: `Command succeeded: ${command}`,
          details: result.stdout.slice(0, 300),
          category: 'build',
        };
      }

      return {
        check: `cmd:${description}`,
        status: 'fail',
        message: `Command failed: ${command} (exit code ${result.exitCode}, expected ${expectExitCode})`,
        details: (result.stderr || result.stdout).slice(0, 500),
        category: 'build',
      };
    } catch (err: any) {
      if (err.isTimeout) {
        return {
          check: `cmd:${description}`,
          status: 'fail',
          message: `Command timed out after ${timeout}ms: ${command}`,
          category: 'build',
        };
      }
      return {
        check: `cmd:${description}`,
        status: 'error',
        message: `Failed to run command: ${err.message}`,
        category: 'build',
      };
    }
  }
}

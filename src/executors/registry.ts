/**
 * ## Executor Registry
 *
 * Central registry for all validator executor types.
 * Follows the registry pattern — executors register themselves by type.
 *
 * @packageDocumentation
 */

import { type Executor, type ExecutorRegistry, type ExecutorConstructor } from './types.js';

// ─── Implementation ─────────────────────────────────────────────────

class RegistryImpl implements ExecutorRegistry {
  private executors = new Map<string, Executor>();

  register(type: string, executor: ExecutorConstructor | Executor): void {
    if (typeof executor === 'function') {
      this.executors.set(type, new executor());
    } else {
      this.executors.set(type, executor);
    }
  }

  get(type: string): Executor | undefined {
    return this.executors.get(type);
  }

  has(type: string): boolean {
    return this.executors.has(type);
  }

  types(): string[] {
    return Array.from(this.executors.keys());
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export const registry: ExecutorRegistry = new RegistryImpl();

// ─── Auto-Register Built-in Executors ───────────────────────────────

import { FileExistsExecutor } from './file-exists.executor.js';
import { HttpExecutor } from './http.executor.js';
import { FileContainsExecutor } from './file-contains.executor.js';
import { RegexExecutor } from './regex.executor.js';
import { NpmTestExecutor } from './npm-test.executor.js';
import { CliCommandExecutor } from './cli-command.executor.js';
import { DockerExecutor } from './docker.executor.js';
import { TestRunnerExecutor } from './test-runner.executor.js';

registry.register('file-exists', FileExistsExecutor);
registry.register('http', HttpExecutor);
registry.register('file-contains', FileContainsExecutor);
registry.register('regex', RegexExecutor);
registry.register('npm-test', NpmTestExecutor);
registry.register('cli-command', CliCommandExecutor);
registry.register('docker', DockerExecutor);
registry.register('test-runner', TestRunnerExecutor);

// ─── Run All Validators for a Lesson ────────────────────────────────

import type { ExecutorContext, ExecutorResult } from './types.js';

/**
 * Run all validators defined in a lesson's frontmatter.
 * Returns results sorted by severity (fail first, then warn, then pass).
 */
export async function runLessonValidators(
  validationConfig: Array<Record<string, any>>,
  ctx: ExecutorContext
): Promise<ExecutorResult[]> {
  const results: ExecutorResult[] = [];

  if (!validationConfig || !Array.isArray(validationConfig)) {
    return results;
  }

  for (const config of validationConfig) {
    const type = config.type as string;
    if (!type) {
      results.push({
        check: 'unknown',
        status: 'error',
        message: 'Validator config missing "type" field',
        category: 'validation',
      });
      continue;
    }

    const executor = registry.get(type);
    if (!executor) {
      results.push({
        check: type,
        status: 'error',
        message: `Unknown validator type: "${type}". Available: ${registry.types().join(', ') || 'none'}`,
        category: 'validation',
      });
      continue;
    }

    try {
      const result = await executor.execute(config, ctx);
      results.push(result);
    } catch (err: any) {
      results.push({
        check: type,
        status: 'error',
        message: `Validator "${type}" threw an error: ${err.message}`,
        details: err.stack,
        category: 'validation',
      });
    }
  }

  // Sort: errors/fails first, then warnings, then passes
  results.sort((a, b) => {
    const order: Record<string, number> = { error: 0, fail: 1, warn: 2, pass: 3 };
    return (order[a.status] ?? 0) - (order[b.status] ?? 0);
  });

  return results;
}

/**
 * Run validation for a complete set of lesson validators across a track.
 * Returns combined results grouped by lesson.
 */
export async function runTrackValidators(
  trackLessons: Array<{
    title: string;
    lessonDir: string;
    validators: Array<Record<string, any>>;
  }>,
  ctx: ExecutorContext
): Promise<Record<string, ExecutorResult[]>> {
  const results: Record<string, ExecutorResult[]> = {};

  for (const lesson of trackLessons) {
    if (lesson.validators.length > 0) {
      results[lesson.title] = await runLessonValidators(lesson.validators, {
        ...ctx,
        lessonDir: lesson.lessonDir,
      });
    }
  }

  return results;
}

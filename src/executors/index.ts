/**
 * ## Executors Module
 *
 * Validator plugin architecture for the CLI.
 * Each executor validates a specific aspect of a user's implementation.
 *
 * @packageDocumentation
 */

export { registry, runLessonValidators, runTrackValidators } from './registry.js';
export type { Executor, ExecutorContext, ExecutorResult, ExecutorRegistry, ExecutorStatus } from './types.js';

export { FileExistsExecutor } from './file-exists.executor.js';
export { HttpExecutor } from './http.executor.js';
export { FileContainsExecutor } from './file-contains.executor.js';
export { RegexExecutor } from './regex.executor.js';
export { NpmTestExecutor } from './npm-test.executor.js';
export { CliCommandExecutor } from './cli-command.executor.js';
export { DockerExecutor } from './docker.executor.js';
export { TestRunnerExecutor } from './test-runner.executor.js';

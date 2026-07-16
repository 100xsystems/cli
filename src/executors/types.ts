/**
 * ## Executor Types
 *
 * Shared types for the validator plugin architecture.
 * Each executor validates a specific aspect of a user's implementation.
 *
 * @packageDocumentation
 */

// ─── Execution Context ──────────────────────────────────────────────

export interface ExecutorContext {
  /** Absolute path to the user's project directory (where 100xsystems.json lives) */
  projectDir: string;

  /** Absolute path to the current lesson directory in the curriculum */
  lessonDir: string;

  /** Free-form workspace info (e.g., system slug) */
  workspace: string;
}

// ─── Execution Result ───────────────────────────────────────────────

export type ExecutorStatus = 'pass' | 'warn' | 'fail' | 'error';

export interface ExecutorResult {
  /** Which check was performed */
  check: string;

  /** pass / warn / fail / error */
  status: ExecutorStatus;

  /** Human-readable message */
  message: string;

  /** Optional detailed output (e.g., command stdout) */
  details?: string;

  /** Category for reporting */
  category: 'validation' | 'structure' | 'test' | 'build' | 'deploy';
}

// ─── Executor Interface ─────────────────────────────────────────────

export interface Executor {
  /** Unique type identifier (e.g., "http", "file-exists", "docker") */
  type: string;

  /** Execute the validation check */
  execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult>;
}

// ─── Registry Types ─────────────────────────────────────────────────

export type ExecutorConstructor = new () => Executor;

export interface ExecutorRegistry {
  /** Register an executor by type name */
  register(type: string, executor: ExecutorConstructor | Executor): void;

  /** Get an executor by type name */
  get(type: string): Executor | undefined;

  /** Check if an executor type is registered */
  has(type: string): boolean;

  /** Get all registered executor types */
  types(): string[];
}

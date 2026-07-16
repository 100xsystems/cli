/**
 * ## FileExists Executor
 *
 * Validates that a file or directory exists in the user's project.
 * Can also check minimum file size and content presence.
 *
 * @example
 * validation:
 *   - type: file-exists
 *     path: "src/main.ts"
 *
 *   - type: file-exists
 *     path: "src/main.ts"
 *     min_size: 100
 *
 *   - type: file-exists
 *     path: "design/decisions.md"
 *     must_contain: "Context"
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

export class FileExistsExecutor implements Executor {
  type = 'file-exists';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const filePath = params.path as string;
    if (!filePath) {
      return {
        check: 'file-exists',
        status: 'fail',
        message: 'Missing "path" parameter in validator config',
        category: 'validation',
      };
    }

    const fullPath = path.resolve(ctx.projectDir, filePath);
    const exists = fs.existsSync(fullPath);

    if (!exists) {
      return {
        check: `file-exists:${filePath}`,
        status: 'fail',
        message: `Required file/directory not found: ${filePath}`,
        category: 'structure',
      };
    }

    // Check minimum size if specified
    const minSize = params.min_size as number | undefined;
    if (minSize !== undefined && fs.statSync(fullPath).size < minSize) {
      return {
        check: `file-exists:${filePath}`,
        status: 'warn',
        message: `${filePath} exists but is smaller than expected (${minSize} bytes)`,
        category: 'structure',
      };
    }

    // Check file content contains a string if specified
    const mustContain = params.must_contain as string | undefined;
    if (mustContain && fs.statSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (!content.includes(mustContain)) {
        return {
          check: `file-exists:${filePath}`,
          status: 'warn',
          message: `${filePath} exists but does not contain expected content: "${mustContain}"`,
          category: 'structure',
        };
      }
    }

    const stat = fs.statSync(fullPath);
    const typeLabel = stat.isDirectory() ? 'directory' : 'file';

    return {
      check: `file-exists:${filePath}`,
      status: 'pass',
      message: `${typeLabel} exists: ${filePath}`,
      category: 'structure',
    };
  }
}

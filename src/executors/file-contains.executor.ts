/**
 * ## FileContains Executor
 *
 * Validates that a file contains (or does not contain) specific content.
 * Supports exact string matching and regex patterns.
 *
 * @example
 * validation:
 *   - type: file-contains
 *     path: "design/decisions.md"
 *     contains: "Kafka"
 *
 *   - type: file-contains
 *     path: "README.md"
 *     pattern: "^# \\w+"
 *     description: "Has a level-1 heading"
 *
 *   - type: file-contains
 *     path: ".env.example"
 *     does_not_contain: "PASSWORD"
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

export class FileContainsExecutor implements Executor {
  type = 'file-contains';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const filePath = params.path as string;
    if (!filePath) {
      return {
        check: 'file-contains',
        status: 'fail',
        message: 'Missing "path" parameter in validator config',
        category: 'validation',
      };
    }

    const fullPath = path.resolve(ctx.projectDir, filePath);
    if (!fs.existsSync(fullPath)) {
      return {
        check: `file-contains:${filePath}`,
        status: 'fail',
        message: `File not found: ${filePath}`,
        category: 'structure',
      };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const description = (params.description as string) || filePath;

    // Check for required content (string match)
    const contains = params.contains as string | undefined;
    if (contains !== undefined) {
      if (!content.includes(contains)) {
        return {
          check: `file-contains:${filePath}`,
          status: 'fail',
          message: `${description}: expected to contain "${contains}"`,
          details: `File: ${filePath}`,
          category: 'structure',
        };
      }
    }

    // Check for required content (regex match)
    const pattern = params.pattern as string | undefined;
    if (pattern !== undefined) {
      try {
        const regex = new RegExp(pattern, 'm');
        if (!regex.test(content)) {
          return {
            check: `file-contains:${filePath}`,
            status: 'fail',
            message: `${description}: expected to match pattern /${pattern}/`,
            details: `File: ${filePath}`,
            category: 'structure',
          };
        }
      } catch (err: any) {
        return {
          check: `file-contains:${filePath}`,
          status: 'error',
          message: `Invalid regex pattern "${pattern}": ${err.message}`,
          category: 'validation',
        };
      }
    }

    // Check for forbidden content
    const doesNotContain = params.does_not_contain as string | undefined;
    if (doesNotContain !== undefined) {
      if (content.includes(doesNotContain)) {
        return {
          check: `file-contains:${filePath}`,
          status: 'warn',
          message: `${description}: should not contain "${doesNotContain}"`,
          details: `File: ${filePath}`,
          category: 'structure',
        };
      }
    }

    return {
      check: `file-contains:${filePath}`,
      status: 'pass',
      message: `${description}: content validation passed`,
      category: 'structure',
    };
  }
}

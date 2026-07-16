/**
 * ## HTTP Executor
 *
 * Validates that an HTTP endpoint responds correctly.
 * Can check status codes, response body content, headers, and response time.
 *
 * @example
 * validation:
 *   - type: http
 *     url: "http://localhost:3000/health"
 *     method: GET
 *     expect_status: 200
 *     expect_body_contains: "\"status\": \"ok\""
 *     timeout: 5000
 *
 * @packageDocumentation
 */

import { type Executor, type ExecutorResult, type ExecutorContext } from './types.js';

export class HttpExecutor implements Executor {
  type = 'http';

  async execute(params: Record<string, any>, ctx: ExecutorContext): Promise<ExecutorResult> {
    const url = params.url as string;
    if (!url) {
      return {
        check: 'http',
        status: 'fail',
        message: 'Missing "url" parameter in validator config',
        category: 'validation',
      };
    }

    const method = (params.method as string) || 'GET';
    const expectStatus = params.expect_status as number | undefined;
    const expectBodyContains = params.expect_body_contains as string | undefined;
    const expectHeader = params.expect_header as Record<string, string> | undefined;
    const timeout = (params.timeout as number) || 10000;
    const headers = (params.headers as Record<string, string>) || {};
    const body = params.body as string | undefined;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method,
        headers: {
          'Accept': 'application/json',
          ...headers,
        },
        body: body || undefined,
        signal: controller.signal,
      });
      const responseTime = Date.now() - startTime;
      clearTimeout(timeoutId);

      const responseBody = await response.text();
      const failures: string[] = [];

      // Check status code
      if (expectStatus !== undefined && response.status !== expectStatus) {
        failures.push(`Expected status ${expectStatus}, got ${response.status}`);
      }

      // Check response body content
      if (expectBodyContains && !responseBody.includes(expectBodyContains)) {
        failures.push(`Response body does not contain expected content: "${expectBodyContains}"`);
      }

      // Check response headers
      if (expectHeader) {
        for (const [key, value] of Object.entries(expectHeader)) {
          const headerValue = response.headers.get(key);
          if (headerValue !== value) {
            failures.push(`Expected header "${key}: ${value}", got "${headerValue || 'undefined'}"`);
          }
        }
      }

      // Check response time if specified
      const maxTime = params.max_response_time as number | undefined;
      if (maxTime !== undefined && responseTime > maxTime) {
        failures.push(`Response time ${responseTime}ms exceeds maximum ${maxTime}ms`);
      }

      if (failures.length > 0) {
        return {
          check: `http:${method} ${url}`,
          status: 'fail',
          message: failures.join('; '),
          details: responseBody.slice(0, 500),
          category: 'validation',
        };
      }

      return {
        check: `http:${method} ${url}`,
        status: 'pass',
        message: `${method} ${url} → ${response.status} (${responseTime}ms)`,
        category: 'validation',
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        return {
          check: `http:${method} ${url}`,
          status: 'fail',
          message: `Request timed out after ${timeout}ms: ${method} ${url}`,
          category: 'validation',
        };
      }
      return {
        check: `http:${method} ${url}`,
        status: 'fail',
        message: `Request failed: ${err.message}`,
        category: 'validation',
      };
    }
  }
}

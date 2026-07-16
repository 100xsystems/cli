import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from './Divider.js';
import type { ValidationResult } from '../actions/validate.js';

interface ValidationReportProps {
  results: ValidationResult[];
  systemTitle: string;
}

/**
 * Displays validation results grouped by category.
 * Shows pass/warn/fail counts and lists issues.
 */
export function ValidationReport({ results, systemTitle }: ValidationReportProps) {
  const passCount = results.filter(r => r.status === 'pass').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const failCount = results.filter(r => r.status === 'fail').length;

  // Group by category
  const categories = ['documentation', 'structure', 'git'] as const;
  const grouped = categories.map(cat => ({
    name: cat.charAt(0).toUpperCase() + cat.slice(1),
    items: results.filter(r => r.category === cat),
  })).filter(g => g.items.length > 0);

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>  100xSystems — Validating &quot;{systemTitle}&quot;</Text>

      <Box marginY={1} />

      {grouped.map(group => (
        <Box key={group.name} flexDirection="column" marginBottom={1}>
          <Text bold>{'  '}{group.name}</Text>
          {group.items.map((result, i) => {
            const icon = result.status === 'pass' ? <Text color="green">✓</Text>
              : result.status === 'warn' ? <Text color="yellow">⚠</Text>
              : <Text color="red">✗</Text>;
            return (
              <Text key={i}>
                <Text>  </Text>
                {icon}
                <Text> {result.message}</Text>
              </Text>
            );
          })}
        </Box>
      ))}

      <Divider />

      <Box>
        <Text bold>  Validation Results:</Text>
        <Text> </Text>
        <Text color="green">{passCount} passed</Text>
        {warnCount > 0 && (
          <Text>
            <Text>, </Text>
            <Text color="yellow">{warnCount} warnings</Text>
          </Text>
        )}
        {failCount > 0 && (
          <Text>
            <Text>, </Text>
            <Text color="red">{failCount} failed</Text>
          </Text>
        )}
      </Box>

      <Box marginTop={1}>
        {failCount === 0 ? (
          <Text color="green">  Your project is ready for submission!</Text>
        ) : (
          <Text color="yellow">  {failCount} check(s) failed. Complete the missing items before submitting.</Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * Compact summary component for the submit flow.
 * Shows only the pass/warn/fail counts and lists broken items.
 */
export function ValidationSummary({ results }: { results: ValidationResult[] }) {
  const passCount = results.filter(r => r.status === 'pass').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const failures = results.filter(r => r.status === 'fail');
  const warnings = results.filter(r => r.status === 'warn');

  return (
    <Box flexDirection="column" paddingX={2} marginY={1}>
      <Text bold>  Validation Summary</Text>
      <Box>
        <Text>  </Text>
        <Text color="green">✓ {passCount} passed</Text>
        {warnCount > 0 && (
          <Text>
            <Text>  </Text>
            <Text color="yellow">⚠ {warnCount} warnings</Text>
          </Text>
        )}
        {failCount > 0 && (
          <Text>
            <Text>  </Text>
            <Text color="red">✗ {failCount} failed</Text>
          </Text>
        )}
      </Box>

      {failures.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {failures.map((f, i) => (
            <Text key={i}>
              <Text>       </Text>
              <Text color="red">·</Text>
              <Text> {f.message}</Text>
            </Text>
          ))}
        </Box>
      )}

      {failures.length === 0 && warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {warnings.map((w, i) => (
            <Text key={i}>
              <Text>       </Text>
              <Text color="yellow">·</Text>
              <Text> {w.message}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

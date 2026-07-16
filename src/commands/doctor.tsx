import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ui/index.js';
import zod from 'zod';
import { execaSync } from 'execa';

export const args = zod.tuple([
  zod.string().optional().describe('Optional system slug to show relevant tools only'),
]);

type Props = {
  args: zod.infer<typeof args>;
};

interface ToolCheck {
  name: string;
  command: string;
  required: boolean;
}

interface CheckResult {
  name: string;
  found: boolean;
  version?: string;
  required: boolean;
  ok: boolean;
}

const TOOLS: ToolCheck[] = [
  { name: 'Node.js', command: 'node --version', required: true },
  { name: 'Git', command: 'git --version', required: true },
  { name: 'npm', command: 'npm --version', required: true },
  { name: 'TypeScript', command: 'npx tsc --version 2>/dev/null', required: false },
  { name: 'Java (JDK)', command: 'java -version 2>&1', required: false },
  { name: 'Maven', command: 'mvn --version 2>&1 | head -1', required: false },
  { name: 'Docker', command: 'docker --version 2>/dev/null', required: false },
  { name: 'Docker Compose', command: 'docker compose version 2>/dev/null', required: false },
  { name: 'Kubernetes (kubectl)', command: 'kubectl version --client 2>/dev/null', required: false },
  { name: 'Terraform', command: 'terraform --version 2>/dev/null | head -1', required: false },
  { name: 'AWS CLI', command: 'aws --version 2>&1', required: false },
  { name: 'Python 3', command: 'python3 --version 2>/dev/null || python --version 2>/dev/null', required: false },
  { name: 'Go', command: 'go version 2>/dev/null', required: false },
  { name: 'Rust (cargo)', command: 'cargo --version 2>/dev/null', required: false },
];

const SYSTEM_TOOLS: Record<string, string[]> = {
  'claude-code': ['Node.js', 'Git', 'npm', 'TypeScript', 'Docker'],
  'microservices': ['Node.js', 'Git', 'npm', 'Docker', 'Docker Compose'],
  'event-driven': ['Node.js', 'Git', 'npm', 'Docker'],
  'kubernetes': ['Node.js', 'Git', 'npm', 'Docker', 'Kubernetes (kubectl)', 'Docker Compose'],
  'terraform': ['Node.js', 'Git', 'npm', 'Terraform'],
  'aws-infrastructure': ['Node.js', 'Git', 'npm', 'AWS CLI', 'Terraform'],
  'java-microservices': ['Node.js', 'Git', 'npm', 'Java (JDK)', 'Maven', 'Docker'],
  'go-service': ['Node.js', 'Git', 'npm', 'Go', 'Docker'],
  'rust-tool': ['Node.js', 'Git', 'npm', 'Rust (cargo)'],
};

function checkTool(tool: ToolCheck): CheckResult {
  try {
    const result = execaSync(tool.command, { shell: true, timeout: 10000 });
    const version = result.stdout.split('\n')[0].trim() || result.stderr.split('\n')[0].trim();
    return { name: tool.name, found: true, version, required: tool.required, ok: true };
  } catch {
    return { name: tool.name, found: false, required: tool.required, ok: false };
  }
}

function filterToolsForSystem(systemSlug: string): ToolCheck[] {
  const relevantNames = SYSTEM_TOOLS[systemSlug];
  if (!relevantNames || relevantNames.length === 0) return TOOLS;
  return TOOLS.filter((tool) => relevantNames.includes(tool.name));
}

function runToolChecks(systemSlug?: string): CheckResult[] {
  const toolsToCheck = systemSlug ? filterToolsForSystem(systemSlug) : TOOLS;
  return toolsToCheck.map(checkTool);
}

export default function Doctor({ args }: Props) {
  const [systemSlug] = args;
  const [results, setResults] = useState<CheckResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const checks = runToolChecks(systemSlug);
      setResults(checks);
    } catch (err: any) {
      setError(err.message);
    }
  }, [systemSlug]);

  if (error) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color="red">  {error}</Text>
      </Box>
    );
  }

  if (results.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Checking environment...</Text>
      </Box>
    );
  }

  const requiredOk = results.filter((r) => r.required && r.ok).length;
  const requiredFail = results.filter((r) => r.required && !r.ok).length;
  const optionalFound = results.filter((r) => !r.required && r.ok).length;

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>{'  '}100xSystems — Environment Doctor</Text>
      {systemSlug && <Text dimColor>{'  '}Checking tools for: <Text bold>{systemSlug}</Text></Text>}
      {!systemSlug && <Text dimColor>{'  '}Checking all available tools...</Text>}
      <Box marginY={1} />

      {results.map((result) => (
        <Box key={result.name}>
          {result.found ? (
            <Text>{'  '}<Text color="green">✓</Text> {result.name.padEnd(18)} <Text dimColor>{result.version || ''}</Text></Text>
          ) : result.required ? (
            <Text>{'  '}<Text color="red">✗</Text> {result.name.padEnd(18)} <Text color="red">NOT FOUND (required)</Text></Text>
          ) : (
            <Text>{'  '}<Text dimColor>○</Text> {result.name.padEnd(18)} <Text dimColor>not found (optional)</Text></Text>
          )}
        </Box>
      ))}

      <Box marginY={1} />
      <Text>{'  '}<Text dimColor>─{'─'.repeat(38)}</Text></Text>
      <Text bold>{'  '}Summary:</Text>
      <Text color="green">{'  '}{requiredOk} required tools OK</Text>

      {requiredFail > 0 ? (
        <Box flexDirection="column">
          <Text color="red">{'  '}{requiredFail} required tools MISSING</Text>
          <Box marginY={1} />
          <Text dimColor>{'  '}Install missing tools:</Text>
          {results.filter(r => !r.ok).map(r => (
            <Text key={r.name} dimColor>{'    '}• {r.name}</Text>
          ))}
        </Box>
      ) : (
        <Text color="green">{'  '}Environment looks good!</Text>
      )}

      <Text dimColor>{'  '}{optionalFound} optional tools found</Text>
    </Box>
  );
}

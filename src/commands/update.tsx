import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ui/index.js';
import { execaSync } from 'execa';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_NAME = '@100xsystems/cli';

function getLocalVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export default function Update() {
  const [output, setOutput] = useState<React.ReactNode>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const localVersion = getLocalVersion();

      // Check npm registry for latest version
      let latestVersion: string;
      try {
        const result = execaSync('npm', ['view', PACKAGE_NAME, 'version'], {
          shell: true,
          timeout: 10000,
        });
        latestVersion = result.stdout.trim();
      } catch {
        setOutput(
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text color="yellow">  Could not check for updates.</Text>
            <Text dimColor>  Make sure you have internet access and npm is configured.</Text>
            <Text dimColor>{'  '}Local version: {localVersion}</Text>
          </Box>
        );
        return;
      }

      if (localVersion === latestVersion) {
        setOutput(
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text color="green">  ✓ You&rsquo;re up to date!</Text>
            <Text dimColor>{'  '}Version: {latestVersion}</Text>
          </Box>
        );
      } else {
        setOutput(
          <Box flexDirection="column" paddingX={2} paddingY={1}>
            <Text color="yellow">  ⟳ Update available!</Text>
            <Box marginY={1} />
            <Text>{'  '}Current: <Text color="red">{localVersion}</Text></Text>
            <Text>{'  '}Latest:  <Text color="green">{latestVersion}</Text></Text>
            <Box marginY={1} />
            <Text color="cyan">{'  '}npm update -g {PACKAGE_NAME}  <Text dimColor>→ upgrade</Text></Text>
          </Box>
        );
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  if (error) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="red">  ✗ Failed to check for updates: {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {output || <Text dimColor>  Checking for updates...</Text>}
    </Box>
  );
}

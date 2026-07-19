/**
 * ## Verify Solutions Command
 *
 * Cumulatively verifies that all lesson solutions compile and pass tests.
 * Runs for a specific system + track, producing a human-readable report
 * and a JSON report for CI consumption.
 *
 * Usage:
 *   100xsystems verify-solutions <system> [track]
 *
 * Examples:
 *   100xsystems verify-solutions claude-code
 *   100xsystems verify-solutions claude-code track-typescript
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import zod from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { verifySolutions, formatReport, formatReportJson, type VerificationReport } from '../actions/verify-solutions.js';
import { getSystemTracks } from '../reader/lesson-reader.js';
import { systemExists } from '../reader/system-reader.js';

export const args = zod.tuple([
  zod.string().describe('System slug (e.g., claude-code)'),
  zod.string().optional().describe('Track slug (e.g., track-typescript). Omit for all tracks.'),
]);

type Props = {
  args: zod.infer<typeof args>;
};

export default function VerifySolutions({ args }: Props) {
  const [systemSlug] = args;
  const [phase, setPhase] = useState<
    { name: 'loading' } |
    { name: 'verifying'; track: string } |
    { name: 'done'; report: VerificationReport[] } |
    { name: 'error'; message: string }
  >({ name: 'loading' });

  useEffect(() => {
    (async () => {
      const trackSlug = args[1] || '';

      if (!systemExists(systemSlug)) {
        setPhase({ name: 'error', message: `System "${systemSlug}" not found.` });
        return;
      }

      const tracks = trackSlug
        ? [{ slug: trackSlug }]
        : getSystemTracks(systemSlug);

      if (tracks.length === 0) {
        setPhase({ name: 'error', message: `No tracks found for system "${systemSlug}".` });
        return;
      }

      const reports: VerificationReport[] = [];
      for (const track of tracks) {
        setPhase({ name: 'verifying', track: track.slug });
        const report = await verifySolutions(systemSlug, track.slug);
        reports.push(report);

        // Write JSON report
        const reportDir = path.join(os.tmpdir(), '100x-verify-reports');
        fs.mkdirSync(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `${systemSlug}-${track.slug}.json`);
        fs.writeFileSync(reportPath, formatReportJson(report));
      }

      setPhase({ name: 'done', report: reports });
    })();
  }, []);

  if (phase.name === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Loading system info...</Text>
      </Box>
    );
  }

  if (phase.name === 'verifying') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text dimColor>  Verifying solutions for {systemSlug}/{phase.track}...</Text>
      </Box>
    );
  }

  if (phase.name === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text color="yellow">  {phase.message}</Text>
      </Box>
    );
  }

  // Done phase
  return (
    <Box flexDirection="column" paddingX={2}>
      {phase.report.map((report, idx) => (
        <Box key={idx} flexDirection="column" marginBottom={1}>
          <Text>{'  '}{formatReport(report).trim().split('\n').map((line, i) => (
            <React.Fragment key={i}>
              {i === 0 ? <Text bold color="cyan">{line}</Text> : <Text>{line === '' ? ' ' : line}</Text>}
              {'\n'}
            </React.Fragment>
          ))}</Text>
        </Box>
      ))}
    </Box>
  );
}

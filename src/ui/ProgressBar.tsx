import React from 'react';
import { Box, Text } from 'ink';

interface ProgressBarProps {
  current: number;
  total: number;
  label?: string;
  barWidth?: number;
  color?: string;
}

/**
 * A simple progress bar component.
 * Shows current/total with a colored bar.
 */
export function ProgressBar({
  current,
  total,
  label,
  barWidth = 20,
  color = 'cyan',
}: ProgressBarProps) {
  const percentage = total > 0 ? Math.min(Math.round((current / total) * 100), 100) : 0;
  const filled = Math.round((barWidth * percentage) / 100);
  const empty = barWidth - filled;

  return (
    <Box>
      {label && <Text dimColor>{label}: </Text>}
      <Text>
        <Text color={color}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(empty)}</Text>
        <Text> {percentage}%</Text>
      </Text>
    </Box>
  );
}

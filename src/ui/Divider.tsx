import React from 'react';
import { Box, Text } from 'ink';

interface DividerProps {
  title?: string;
  color?: string;
  width?: number;
  padding?: number;
}

/**
 * A horizontal divider line, optionally with a title.
 * Replaces inline chalk separator blocks.
 */
export function Divider({
  title,
  color = '#888',
  width = 40,
  padding = 2,
}: DividerProps) {
  if (title) {
    const lineLength = Math.max(width - title.length - padding, 2);
    const halfLine = Math.floor(lineLength / 2);
    return (
      <Box paddingY={1}>
        <Text color={color}>
          {'─'.repeat(halfLine)} {title} {'─'.repeat(halfLine)}
        </Text>
      </Box>
    );
  }

  return (
    <Box paddingY={1}>
      <Text color={color}>{'─'.repeat(width)}</Text>
    </Box>
  );
}

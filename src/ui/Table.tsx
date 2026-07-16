import React from 'react';
import { Box, Text } from 'ink';

export interface Column<T = any> {
  key: string;
  title: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: any, row: T) => string;
}

interface TableProps<T = any> {
  data: T[];
  columns: Column<T>[];
  headerColor?: string;
  borderColor?: string;
  title?: string;
}

/**
 * A simple table component.
 * Each column has a key, title, and optional format function.
 */
export function Table<T extends Record<string, any>>({
  data,
  columns,
  headerColor = 'bold',
  borderColor = 'gray',
  title,
}: TableProps<T>) {
  if (data.length === 0) return null;

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
        </Box>
      )}

      {/* Header */}
      <Box>
        {columns.map((col, i) => (
          <Box key={col.key} width={col.width || 20} marginRight={i < columns.length - 1 ? 1 : 0}>
            <Text bold color={headerColor === 'bold' ? undefined : headerColor}>
              {col.title}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Separator */}
      <Text color={borderColor || 'gray'}>
        {columns.map((col, i) => {
          const width = col.width || 20;
          const sep = '─'.repeat(width);
          return sep + (i < columns.length - 1 ? '─' : '');
        }).join('')}
      </Text>

      {/* Rows */}
      {data.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {columns.map((col, colIndex) => {
            const value = col.format ? col.format(row[col.key], row) : String(row[col.key] ?? '');
            const width = col.width || 20;
            const align = col.align || 'left';

            let display = value;
            if (align === 'right') display = value.padStart(width);
            else if (align === 'center') {
              const leftPad = Math.floor((width - value.length) / 2);
              display = ' '.repeat(Math.max(leftPad, 0)) + value;
            }

            return (
              <Box key={colIndex} width={width} marginRight={colIndex < columns.length - 1 ? 1 : 0}>
                <Text>{display.slice(0, width)}</Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

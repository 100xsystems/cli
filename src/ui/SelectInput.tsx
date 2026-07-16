/**
 * ## SelectInput
 *
 * A custom interactive select input for Ink CLI apps.
 * Replaces `ink-select-input` which has version incompatibilities
 * with Ink v7 + React 19.
 *
 * Uses Ink's built-in `useInput` hook for keyboard handling.
 * Supports disabled items (skipped during navigation, dimmed rendering).
 *
 * @packageDocumentation
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

// ─── Types ──────────────────────────────────────────────────────────

export interface SelectItem<T = string> {
  label: string;
  value: T;
  key?: string;
  disabled?: boolean;
}

interface SelectInputProps<T = string> {
  items: SelectItem<T>[];
  initialIndex?: number;
  onSelect: (item: SelectItem<T>) => void;
  onHighlight?: (item: SelectItem<T>) => void;
  focus?: boolean;
  limit?: number;
}

/** Find the next non-disabled index starting from a given position. */
function findNextEnabled<T>(items: SelectItem<T>[], from: number, direction: 1 | -1): number {
  const len = items.length;
  let i = from;
  for (let attempt = 0; attempt < len; attempt++) {
    if (!items[i]?.disabled) return i;
    i = (i + direction + len) % len;
  }
  return from; // all disabled — stay put
}

// ─── Component ─────────────────────────────────────────────────────

export default function SelectInput<T = string>({
  items,
  initialIndex = 0,
  onSelect,
  onHighlight,
  focus = true,
  limit,
}: SelectInputProps<T>) {
  const hasLimit = typeof limit === 'number' && items.length > limit;
  const displayItems = hasLimit ? items.slice(0, limit) : items;
  const [selectedIndex, setSelectedIndex] = useState(
    findNextEnabled(displayItems, Math.max(0, initialIndex), 1),
  );

  useInput(
    useCallback(
      (input, key) => {
        if (!focus) return;

        if (input === 'k' || key.upArrow) {
          setSelectedIndex(prev => {
            const next = findNextEnabled(displayItems, prev <= 0 ? displayItems.length - 1 : prev - 1, -1);
            if (typeof onHighlight === 'function' && displayItems[next]) {
              onHighlight(displayItems[next]);
            }
            return next;
          });
          return;
        }

        if (input === 'j' || key.downArrow) {
          setSelectedIndex(prev => {
            const next = findNextEnabled(displayItems, prev >= displayItems.length - 1 ? 0 : prev + 1, 1);
            if (typeof onHighlight === 'function' && displayItems[next]) {
              onHighlight(displayItems[next]);
            }
            return next;
          });
          return;
        }

        if (key.return) {
          const item = displayItems[selectedIndex];
          if (item && !item.disabled && typeof onSelect === 'function') {
            onSelect(item);
          }
          return;
        }

        // Number key selection (1-9)
        if (/^[1-9]$/.test(input)) {
          const targetIndex = Number.parseInt(input, 10) - 1;
          if (targetIndex >= 0 && targetIndex < displayItems.length) {
            const item = displayItems[targetIndex];
            if (item && !item.disabled && typeof onSelect === 'function') {
              onSelect(item);
            }
          }
        }
      },
      [focus, displayItems, selectedIndex, onSelect, onHighlight],
    ),
    { isActive: focus },
  );

  return (
    <Box flexDirection="column">
      {displayItems.map((item, index) => {
        const isSelected = index === selectedIndex;
        const isDisabled = item.disabled;
        const key = item.key || String(item.value) || String(index);
        return (
          <Box key={key}>
            <Box marginRight={1}>
              {isDisabled ? (
                <Text> </Text>
              ) : (
                <Text color={isSelected ? 'blue' : undefined}>
                  {isSelected ? '❯' : ' '}
                </Text>
              )}
            </Box>
            {isDisabled ? (
              <Text dimColor>{item.label}</Text>
            ) : (
              <Text color={isSelected ? 'blue' : undefined}>
                {item.label}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

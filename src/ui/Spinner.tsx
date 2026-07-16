import React from 'react';
import { Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
  label?: string;
}

/**
 * A loading spinner with optional label.
 * Uses ink-spinner under the hood.
 */
export function Spinner({ label }: SpinnerProps) {
  return (
    <Text>
      <Text color="cyan">
        <InkSpinner />
      </Text>
      {label ? <Text> {label}</Text> : null}
    </Text>
  );
}

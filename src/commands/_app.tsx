import React, { Component } from 'react';
import { Box, Text } from '../ui/index.js';
import type { AppProps } from 'pastel';

// ─── Error Boundary ────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class CommandErrorBoundary extends Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text color="red">{'  '}⚠ An unexpected error occurred</Text>
          <Box marginY={1} />
          <Text color="red">{'  '}{this.state.error?.message || 'Unknown error'}</Text>
          <Box marginY={1} />
          <Text dimColor>{'  '}This is a bug. Please report it at:</Text>
          <Text dimColor>{'  '}https://github.com/aryanbatras/100xsystems/issues</Text>
        </Box>
      );
    }

    return this.props.children;
  }
}

// ─── App component ─────────────────────────────────────────────────

/**
 * Pastel custom app — wraps every command with an error boundary
 * and optional shared layout.
 *
 * See: https://github.com/vadimdemedes/pastel#custom-app
 */
export default function App({ Component, commandProps }: AppProps) {
  return (
    <CommandErrorBoundary>
      <Component {...commandProps} />
    </CommandErrorBoundary>
  );
}

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  message: string;
  defaultValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | true;
  onSubmit: (value: string) => void;
}

/**
 * A simple text input component using Ink's useInput.
 * Supports typing, backspace, and Enter to submit.
 */
export function TextInput({ message, defaultValue = '', placeholder, validate, onSubmit }: TextInputProps) {
  const [value, setValue] = useState(defaultValue);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (submitted) return;

    if (key.return) {
      const trimmed = value.trim();
      if (validate) {
        const result = validate(trimmed);
        if (result !== true) {
          setError(result);
          return;
        }
      }
      setSubmitted(true);
      onSubmit(trimmed);
      return;
    }

    if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
      setError(null);
      return;
    }

    // Printable characters only (ignore control sequences)
    if (input.length === 1 && input.charCodeAt(0) >= 32) {
      setValue(prev => prev + input);
      setError(null);
    }
  });

  const displayValue = value || (placeholder ? placeholder : '');

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text>{'  '}{message}</Text>
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Text>
          {value ? (
            <Text bold color="cyan">{value}</Text>
          ) : (
            <Text dimColor>{displayValue || ' '}</Text>
          )}
        </Text>
      </Box>
      {error && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">⚠ {error}</Text>
        </Box>
      )}
      <Box marginTop={1} marginLeft={2}>
        <Text dimColor>(Type your answer, Enter to confirm)</Text>
      </Box>
    </Box>
  );
}

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

interface ConfirmInputProps {
  message: string;
  defaultYes?: boolean;
  onConfirm: (confirmed: boolean) => void;
}

/**
 * A simple Yes/No confirmation prompt.
 * Replaces inquirer.confirm with Ink's useInput hook.
 * Press Y/y to accept, N/n to reject, Enter to use default.
 */
export function ConfirmInput({ message, defaultYes = true, onConfirm }: ConfirmInputProps) {
  const [selected, setSelected] = useState<'yes' | 'no'>(defaultYes ? 'yes' : 'no');
  const [submitted, setSubmitted] = useState(false);

  useInput((input, key) => {
    if (submitted) return;

    if (key.return) {
      setSubmitted(true);
      onConfirm(selected === 'yes');
      return;
    }

    if (input.toLowerCase() === 'y' || key.leftArrow || key.rightArrow) {
      setSelected('yes');
    } else if (input.toLowerCase() === 'n') {
      setSelected('no');
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text>{'  '}{message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          {'  '}
          {selected === 'yes' ? <Text bold color="green">● Yes</Text> : <Text dimColor>○ Yes</Text>}
          <Text>  </Text>
          {selected === 'no' ? <Text bold color="red">● No</Text> : <Text dimColor>○ No</Text>}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>  (Use arrow keys or Y/N, Enter to confirm)</Text>
      </Box>
    </Box>
  );
}

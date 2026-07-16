import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ui/index.js';
import zod from 'zod';
import { isAuthenticated, getCachedUser, clearAuth } from '../auth/index.js';

export const args = zod.tuple([
  zod.enum(['status', 'logout']).optional().describe('Action: status (default), logout'),
]);

type Props = {
  args: zod.infer<typeof args>;
};

export default function Auth({ args }: Props) {
  const [action] = args;
  const [output, setOutput] = useState<React.ReactNode>(null);

  useEffect(() => {
    if (action === 'logout') {
      clearAuth();
      setOutput(
        <Box flexDirection="column" paddingX={2}>
          <Text color="yellow">  Authentication cleared.</Text>
        </Box>
      );
    } else if (isAuthenticated()) {
      const user = getCachedUser();
      if (user) {
        setOutput(
          <Box flexDirection="column" paddingX={2}>
            <Text>{'  '}Authenticated as: <Text bold>{user.name || user.login} ({user.login})</Text></Text>
          </Box>
        );
      } else {
        setOutput(
          <Box flexDirection="column" paddingX={2}>
            <Text>  Authenticated with GitHub.</Text>
          </Box>
        );
      }
    } else {
      setOutput(
        <Box flexDirection="column" paddingX={2}>
          <Text color="yellow">  Not authenticated.</Text>
          <Text dimColor>  Run 100xsystems submit to authenticate.</Text>
        </Box>
      );
    }
  }, [action]);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {output || <Text dimColor>  Checking authentication...</Text>}
    </Box>
  );
}

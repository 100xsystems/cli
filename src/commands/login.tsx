import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ui/index.js';
import zod from 'zod';
import { option } from 'pastel';
import { ensureAuthenticated, isAuthenticated, getCachedUser } from '../auth/index.js';

export const options = zod.object({
  force: zod.boolean().default(false).describe(
    option({ description: 'Force re-authentication even if already logged in', alias: 'f' }),
  ),
});

type Props = {
  options: zod.infer<typeof options>;
};

type LoginPhase =
  | { name: 'checking' }
  | { name: 'already-authenticated'; user: { login: string; name: string } }
  | { name: 'authenticating' }
  | { name: 'success'; user: string }
  | { name: 'error'; message: string };

export default function Login({ options }: Props) {
  const [phase, setPhase] = useState<LoginPhase>({ name: 'checking' });

  useEffect(() => {
    if (phase.name !== 'checking') return;

    // Check if already authenticated
    if (!options.force && isAuthenticated()) {
      const user = getCachedUser();
      if (user) {
        setPhase({ name: 'already-authenticated', user });
      } else {
        setPhase({ name: 'already-authenticated', user: { login: 'unknown', name: 'Unknown' } });
      }
      return;
    }

    // Trigger authentication
    setPhase({ name: 'authenticating' });
  }, [phase, options.force]);

  useEffect(() => {
    if (phase.name !== 'authenticating') return;

    (async () => {
      try {
        const result = await ensureAuthenticated();
        setPhase({ name: 'success', user: result.user });
      } catch (err: any) {
        setPhase({ name: 'error', message: err.message });
      }
    })();
  }, [phase]);

  // ─── Render ─────────────────────────────────────────────────────

  if (phase.name === 'checking') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor>  Checking authentication...</Text>
      </Box>
    );
  }

  if (phase.name === 'already-authenticated') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{'  '}Authenticated as: <Text bold>{phase.user.name} ({phase.user.login})</Text></Text>
        <Text dimColor>{'  '}Use <Text bold>100xsystems login --force</Text> to re-authenticate.</Text>
      </Box>
    );
  }

  if (phase.name === 'authenticating') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>{'  '}GitHub Authentication</Text>
        <Box marginY={1} />
        <Text dimColor>  A browser window will open to authorize 100xSystems.</Text>
        <Text dimColor>  If it doesn't open automatically, follow the URL shown above.</Text>
      </Box>
    );
  }

  if (phase.name === 'success') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="green">{'  '}✓ Authenticated successfully as <Text bold>{phase.user}</Text></Text>
      </Box>
    );
  }

  if (phase.name === 'error') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="red">{'  '}✗ Authentication failed</Text>
        <Text dimColor>{'  '}{phase.message}</Text>
      </Box>
    );
  }

  return null;
}

import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ui/index.js';
import { clearAuth } from '../auth/index.js';

export default function Logout() {
  const [output, setOutput] = useState<React.ReactNode>(null);

  useEffect(() => {
    clearAuth();
    setOutput(
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow">  Authentication cleared.</Text>
        <Text dimColor>  Run 100xsystems login to authenticate again.</Text>
      </Box>
    );
  }, []);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {output || <Text dimColor>  Logging out...</Text>}
    </Box>
  );
}

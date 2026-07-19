/**
 * ## Orchestrator Command
 *
 * The brand-anchor command for 100xSystems CLI.
 * Shows the ASCII art banner and presents all available commands
 * as interactive selectable options. When the user picks one,
 * it executes that command directly.
 *
 * Only one command to remember: `100xsystems`.
 *
 * @packageDocumentation
 */

import React, { useState } from 'react';
import { Box, Text, useApp } from 'ink';
import SelectInput from '../ui/SelectInput.js';
import { execa } from 'execa';
import zod from 'zod';

export const args = zod.tuple([]);

export default function Orchestrator() {
  const { exit } = useApp();
  const [navigateTo, setNavigateTo] = useState<string | null>(null);

  const handleSelect = async (item: { label: string; value: string }) => {
    const cmd = item.value;
    setNavigateTo(cmd);

    // Resolve the CLI entry point from the compiled file location
    let cliEntry: string;
    try {
      cliEntry = new URL('../../dist/index.js', import.meta.url).pathname;
    } catch {
      exit();
      return;
    }

    try {
      await execa(process.execPath, [cliEntry, cmd], { stdio: 'inherit' });
    } catch {
      // Subcommand exited with non-zero code — that's expected sometimes
    }
    exit();
  };

  // Show message while launching
  if (navigateTo) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor>{'  '}Launching 100xsystems {navigateTo}...</Text>
      </Box>
    );
  }

  const commands = [
    { label: '  init <system>    — Scaffold a new project', value: 'init' },
    { label: '  doctor           — Check dev environment', value: 'doctor' },
    { label: '  validate         — Check implementation against spec', value: 'validate' },
    { label: '  solution         — Copy lesson solution into project', value: 'solution' },
    { label: '  progress         — Show per-lesson progress', value: 'progress' },
    { label: '  submit           — Submit for review', value: 'submit' },
    { label: '  list             — Quick system listing', value: 'list' },
    { label: '  login            — Authenticate with GitHub', value: 'login' },
    { label: '  logout           — Clear authentication', value: 'logout' },
    { label: '  auth             — Check auth status', value: 'auth' },
    { label: '  update           — Check for CLI updates', value: 'update' },
    { label: '  contribute       — Scaffold curriculum content', value: 'contribute' },
  ];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Banner />
      <Box marginY={1} />
      <Box flexDirection="column" marginLeft={4}>
        <Text bold color="green">  100x SYSTEMS  </Text>
        <Text dimColor>  Engineering mastery, one system at a time</Text>
      </Box>
      <Box marginY={1} />
      <Box marginLeft={4}>
        <Text bold underline color="cyan">  SELECT A COMMAND</Text>
      </Box>
      <Box marginY={1} />
      <Box marginLeft={4}>
        <SelectInput items={commands} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}

// ─── ASCII Art Banner ──────────────────────────────────────────────

function Banner() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">
        {'  _  ___   ___        ____            _                      '}
      </Text>
      <Text color="cyan">
        {' / |/ _ \\ / _ \\__  __/ ___| _   _ ___| |_ ___ _ __ ___  ___ '}
      </Text>
      <Text color="cyan">
        {' | | | | | | | \\ \\/ /\\___ \\| | | / __| __/ _ \\ \'_ ` _ \\/ __|'}
      </Text>
      <Text color="cyan">
        {' | | |_| | |_| |>  <  ___) | |_| \\__ \\ ||  __/ | | | | \\__ \\'}
      </Text>
      <Text color="cyan">
        {' |_|\\___/ \\___//_/\\_\\|____/ \\__, |___/\\__\\___|_| |_| |_|___/'}
      </Text>
      <Text color="cyan">
        {'                            |___/                             '}
      </Text>
    </Box>
  );
}

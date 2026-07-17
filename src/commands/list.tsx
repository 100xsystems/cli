import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ui/index.js';
import zod from 'zod';
import { fetchRegistry, syncSystemFromRegistry } from '../reader/index.js';
import { getAllSystems, getSystemMeta, getSystemFolderTags } from '../reader/system-reader.js';

export const args = zod.tuple([
  zod.string().optional().describe('Optional system slug to show details'),
]);

type Props = {
  args: zod.infer<typeof args>;
};

export default function List({ args }: Props) {
  const [systemSlug] = args;
  const [output, setOutput] = useState<React.ReactNode>(null);

  useEffect(() => {
    (async () => {
      // Sync systems from registry (best-effort)
      try {
        const registry = await fetchRegistry();
        if (registry.systems) {
          for (const sys of registry.systems) {
            try { await syncSystemFromRegistry(sys.slug, sys.repo); } catch {}
          }
        }
      } catch {}

      if (systemSlug) {
        const system = getSystemMeta(systemSlug);
        if (!system) {
          setOutput(
            <Box flexDirection="column" paddingX={2}>
              <Text color="red">  System &ldquo;{systemSlug}&rdquo; not found.</Text>
              <Text dimColor>  Run 100xsystems list to see all available systems.</Text>
            </Box>
          );
          return;
        }

        const folderTags = getSystemFolderTags(systemSlug);
        setOutput(
          <Box flexDirection="column" paddingX={2}>
            <Text bold>{'  '}{system.title}</Text>
            {system.description && <Text dimColor>{'  '}{system.description}</Text>}
            {system.tags.length > 0 && (
              <Text dimColor>{'  '}{system.tags.join(' · ')}</Text>
            )}
            <Box marginY={1} />
            {folderTags.length === 0 ? (
              <Text color="yellow">  No sections found for this system.</Text>
            ) : (
              folderTags.map((tag) => (
                <Box key={tag.tag} flexDirection="column" marginBottom={1}>
                  <Text bold>{'  '}{tag.displayName} <Text dimColor>({tag.children.length} items)</Text></Text>
                  {tag.children.map((child) => (
                    <Box key={child.slug} marginLeft={2}>
                      <Text dimColor>{child.type === 'folder' ? '📁' : '📄'} {child.title}</Text>
                    </Box>
                  ))}
                  {tag.tag === 'specification' && (
                    <Text color="cyan">{'    '}100xsystems validate  <Text dimColor>→ check your implementation</Text></Text>
                  )}
                  {tag.tag === 'implementation' && (
                    <Text color="cyan">{'    '}100xsystems init {systemSlug} --lang &lt;language&gt;  <Text dimColor>→ scaffold project</Text></Text>
                  )}
                </Box>
              ))
            )}
          </Box>
        );
      } else {
        const systems = getAllSystems();
        if (systems.length === 0) {
          setOutput(
            <Box flexDirection="column" paddingX={2}>
              <Text color="yellow">  No systems found in curriculum.</Text>
              <Text dimColor>  Ensure the curriculum/ directory exists with system folders.</Text>
            </Box>
          );
          return;
        }

        setOutput(
          <Box flexDirection="column" paddingX={2}>
            <Text bold>{'\n  100xSystems — Available Systems\n'}</Text>
            {systems.map((sys) => {
              const difficultyColor = sys.difficulty === 'Advanced' ? 'red'
                : sys.difficulty === 'Intermediate' ? 'yellow'
                : 'green';
              return (
                <Box key={sys.slug} flexDirection="column" marginBottom={1} paddingX={2}>
                  <Text bold>{'  '}{sys.title}</Text>
                  <Text dimColor>{'  '}{sys.description}</Text>
                  <Box marginTop={1}>
                    <Text color={difficultyColor}>{'  '}{sys.difficulty}</Text>
                    {sys.tags.length > 0 && (
                      <Text dimColor>{'  '}{sys.tags.join(' · ')}</Text>
                    )}
                  </Box>
                  <Text color="cyan">{'  '}100xsystems list {sys.slug}</Text>
                  <Text dimColor>  → see sections</Text>
                  <Text color="cyan">{'  '}100xsystems init {sys.slug}</Text>
                  <Text dimColor>  → start building</Text>
                </Box>
              );
            })}
          </Box>
        );
      }
    })();
  }, [systemSlug]);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {output || <Text dimColor>  Loading...</Text>}
    </Box>
  );
}

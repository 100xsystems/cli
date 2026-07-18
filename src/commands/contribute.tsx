import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ui/index.js';
import zod from 'zod';
import { option } from 'pastel';
import {
  verifyCurriculumAccess,
  initSystem,
  addTrack,
  addLesson,
} from '../actions/contribute.js';
import type {
  SystemScaffold,
  TrackScaffold,
  ModuleScaffold,
  LessonScaffold,
  ContributeResult,
} from '../actions/contribute.js';

// ─── Args Schema ────────────────────────────────────────────────────

export const args = zod.tuple([
  zod.enum(['init', 'track', 'lesson']).describe('Action: init, track, or lesson'),
  zod.string().optional().describe('System slug (e.g., claude-code)'),
  zod.string().optional().describe('Language or module name (e.g., rust)'),
]);

export const options = zod.object({
  title: zod.string().optional().describe(
    option({ description: 'System title', alias: 't' }),
  ),
  description: zod.string().optional().describe(
    option({ description: 'System description', alias: 'd' }),
  ),
  difficulty: zod.enum(['Beginner', 'Intermediate', 'Advanced']).optional().describe(
    option({ description: 'System difficulty level', alias: 'D' }),
  ),
  language: zod.string().optional().describe(
    option({ description: 'Programming language for track', alias: 'l' }),
  ),
  tags: zod.string().optional().describe(
    option({ description: 'Comma-separated tags', alias: 'g' }),
  ),
});

type Props = {
  args: zod.infer<typeof args>;
  options: zod.infer<typeof options>;
};

// ─── Ink UI Helpers ─────────────────────────────────────────────────

function FileList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Text dimColor>{'  '}{label}:</Text>
      {items.map((f, i) => (
        <Text key={i}>{'    '}📄 {f}</Text>
      ))}
    </Box>
  );
}

// ─── Component ──────────────────────────────────────────────────────

export default function Contribute({ args, options }: Props) {
  const [action, systemSlug, thirdArg] = args;
  const [result, setResult] = useState<ContributeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Verify we're in the monorepo
        const curriculumDir = verifyCurriculumAccess();
        console.error(`  Curriculum: ${curriculumDir}`);

        switch (action) {
          case 'init': {
            if (!systemSlug) {
              setError('Missing system slug. Usage: 100xsystems contribute init {system}');
              return;
            }

            const slug = systemSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const title = options.title || slug.replace(/-/g, ' ')
              .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            const description = options.description || `Learn to build ${title} from scratch.`;
            const difficulty = options.difficulty || 'Intermediate';
            const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : [slug];
            const language = options.language || 'typescript';
            const langTitle = language.charAt(0).toUpperCase() + language.slice(1);

            const scaffold: SystemScaffold = {
              slug,
              title,
              description,
              difficulty,
              tags,
              order: 999,
              tracks: [
                {
                  slug: `track-${language}`,
                  title: `${langTitle} Track`,
                  language,
                  difficulty,
                  modules: [
                    {
                      title: 'Introduction',
                      slug: 'module-1-introduction',
                      lessons: [
                        {
                          title: `Introduction to ${title}`,
                          order: 1,
                          description: `Get started with ${title} using ${langTitle}.`,
                          estimated_time: '30 minutes',
                          knowledge_refs: [],
                          content: '',
                        },
                      ],
                    },
                  ],
                },
              ],
            };

            const res = initSystem(scaffold);
            setResult(res);
            break;
          }

          case 'track': {
            if (!systemSlug || !thirdArg) {
              setError('Missing arguments. Usage: 100xsystems contribute track {system} {language}');
              return;
            }

            const trackTitle = options.title || `${thirdArg.charAt(0).toUpperCase() + thirdArg.slice(1)} Track`;
            const difficulty = options.difficulty || 'Intermediate';

            const res = addTrack(systemSlug, trackTitle, thirdArg, difficulty);
            setResult(res);
            break;
          }

          case 'lesson': {
            if (!systemSlug) {
              setError('Missing system slug. Usage: 100xsystems contribute lesson {system}');
              return;
            }

            const trackSlug = options.language
              ? `track-${options.language}`
              : 'track-typescript';
            const lesson: LessonScaffold = {
              title: options.title || 'New Lesson',
              order: 1,
              description: options.description || 'Lesson description goes here.',
              estimated_time: '30 minutes',
              knowledge_refs: [],
              content: '',
            };

            const res = addLesson(systemSlug, trackSlug, lesson);
            setResult(res);
            break;
          }

          default:
            setError(`Unknown action: ${action}. Use: init, track, or lesson`);
        }
      } catch (err: any) {
        setError(err.message || String(err));
      } finally {
        setBusy(false);
      }
    })();
  }, [action, systemSlug, thirdArg]);

  if (busy) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor>{'  '}Scaffolding curriculum content...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="red">{'  '}⚠ {error}</Text>
      </Box>
    );
  }

  if (result) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>{'  '}✓ Curriculum content created</Text>
        <Box marginY={1} />
        <Text dimColor>{'  '}Location: {result.systemDir}</Text>
        <Box marginY={1} />
        <FileList items={result.filesCreated} label="Files created" />
        <Box marginY={1} />
        <Text bold>{'  '}Next steps:</Text>
        <Text color="cyan">{'  '}  1. Edit the generated Markdown files with lesson content</Text>
        <Text color="cyan">{'  '}  2. Add knowledge_refs to link to knowledge base entries</Text>
        <Text color="cyan">{'  '}  3. Run tests to validate your lessons</Text>
        <Text color="cyan">{'  '}  4. Commit and push your changes</Text>
        <Box marginY={1} />
        {action === 'init' && (
          <Text color="green">
            {'  '}Tip: Run <Text bold>100xsystems contribute track {systemSlug} java</Text> to add another language track
          </Text>
        )}
      </Box>
    );
  }

  return null;
}

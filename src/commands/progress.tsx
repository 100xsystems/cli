/**
 * ## Progress Command
 *
 * Shows per-lesson progress for the current project.
 * Must be run inside a project directory scaffolded by `100x init`.
 * Reads .100x.json to show lesson completion and current position.
 *
 * @packageDocumentation
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import zod from 'zod';
import { readProjectConfig, PROJECT_CONFIG } from '../scaffold/index.js';
import { getSystemMeta } from '../reader/system-reader.js';
import { getSystemTracks, getTrackModules } from '../reader/lesson-reader.js';

export const args = zod.tuple([]);

type Props = {
  args: zod.infer<typeof args>;
};

export default function Progress(_props: Props) {
  const [output, setOutput] = useState<React.ReactNode>(null);

  useEffect(() => {
    const projectDir = process.cwd();
    const config = readProjectConfig(projectDir);

    if (!config) {
      setOutput(
        <Box flexDirection="column" paddingX={2}>
          <Text color="yellow">  No {PROJECT_CONFIG} found.</Text>
          <Text dimColor>  Run <Text color="cyan">100x init &lt;system&gt;</Text> inside a project directory first.</Text>
        </Box>
      );
      return;
    }

    const slug = (config.system as string) || '';
    const trackSlug = (config.track as string) || '';
    const title = (config.systemTitle as string) || slug;
    const progress = config.progress || { completedLessons: [], currentLesson: '' };

    if (!slug) {
      setOutput(
        <Box flexDirection="column" paddingX={2}>
          <Text color="red">  Invalid {PROJECT_CONFIG}: missing system slug.</Text>
        </Box>
      );
      return;
    }

    setOutput(showProjectProgress(slug, title, trackSlug, progress));
  }, []);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {output || <Text dimColor>  Loading progress...</Text>}
    </Box>
  );
}

// ─── Project-Scoped Progress View ───────────────────────────────────

function showProjectProgress(
  slug: string,
  title: string,
  trackSlug: string,
  progress: { completedLessons: string[]; currentLesson: string },
): React.ReactNode {
  const system = getSystemMeta(slug);
  const tracks = getSystemTracks(slug);
  const completed: string[] = progress.completedLessons || [];
  const currentLesson: string = progress.currentLesson || '';

  const children: React.ReactNode[] = [];

  // ── Header ─────────────────────────────────────────────────────
  children.push(
    <Text bold key="h">{'  '}📊 {title} — Progress</Text>
  );
  children.push(<Box key="sp0" marginY={1} />);

  // ── Project Info ───────────────────────────────────────────────
  const totalCompleted = completed.length;
  const allStatus = totalCompleted > 0 ? 'in-progress' : 'not-started';
  const statusIcon = allStatus === 'in-progress' ? '▶' : '○';
  const statusColor = allStatus === 'in-progress' ? 'cyan' : 'dimColor';

  children.push(
    <Box key="info" flexDirection="column" marginLeft={1}>
      <Text>
        <Text bold>System: </Text>{title}
      </Text>
      <Text>
        <Text bold>Track: </Text>{trackSlug}
      </Text>
      <Text>
        <Text bold>Status: </Text>
        <Text color={statusColor as any}>{statusIcon} {allStatus}</Text>
      </Text>
    </Box>
  );
  children.push(<Box key="sp1" marginY={1} />);

  // ── Lesson Progress Per Track ──────────────────────────────────
  if (tracks.length === 0) {
    children.push(
      <Text key="no-tracks" dimColor>{'  '}No tracks found for this system.</Text>
    );
  } else {
    // Find the matching track for this project
    const matchingTrack = tracks.find(t => t.slug === trackSlug) || tracks[0];
    const modules = getTrackModules(slug, matchingTrack.slug);

    if (modules.length === 0) {
      children.push(
        <Text key="no-modules" dimColor>{'  '}No modules found for track <Text bold>{matchingTrack.title}</Text></Text>
      );
    } else {
      const allLessons = modules.flatMap(m => m.lessons);
      const totalLessons = allLessons.length;
      const percent = totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;

      children.push(
        <Text key="track-h" bold>{'  '}Track: {matchingTrack.title} — {totalCompleted}/{totalLessons} lessons ({percent}%)</Text>
      );
      children.push(<Box key="sp2" marginY={1} />);

      for (const mod of modules) {
        const lessonCount = mod.lessons.length;
        const modCompleted = mod.lessons.filter(l => completed.includes(l.slug)).length;

        children.push(
          <Box key={`mod-${mod.slug}`} flexDirection="column" marginLeft={2} marginBottom={1}>
            <Text bold>{'  '}{mod.title} <Text dimColor>({modCompleted}/{lessonCount})</Text></Text>

            {mod.lessons.map((lesson) => {
              const isCompleted = completed.includes(lesson.slug);
              const isCurrent = lesson.slug === currentLesson;
              const icon = isCompleted ? '✓' : isCurrent ? '▶' : '○';
              const color = isCompleted ? 'green' : isCurrent ? 'cyan' : 'dimColor';
              return (
                <Text key={lesson.slug}>
                  {'      '}<Text color={color as any}>{icon}</Text> {lesson.title}
                  {isCurrent && <Text color="cyan">  ← current</Text>}
                </Text>
              );
            })}
          </Box>
        );
      }
    }
  }

  // ── Quick Actions ──────────────────────────────────────────────
  children.push(<Box key="sp3" marginY={1} />);
  children.push(<Text key="actions-h" bold>{'  '}Actions</Text>);

  if (currentLesson) {
    children.push(
      <Text key="act-validate" color="cyan">{'  '}100x validate  <Text dimColor>→ pick a lesson to validate</Text></Text>
    );
  } else {
    children.push(
      <Text key="act-validate-first" color="cyan">{'  '}100x validate  <Text dimColor>→ start validating</Text></Text>
    );
  }

  children.push(
    <Text key="act-submit" color="cyan">{'  '}100x submit  <Text dimColor>→ submit for review</Text></Text>
  );

  if (system) {
    children.push(
      <Text key="act-docs" color="cyan">{'  '}100x list {slug}  <Text dimColor>→ view system details</Text></Text>
    );
  }

  return <Box flexDirection="column">{children}</Box>;
}

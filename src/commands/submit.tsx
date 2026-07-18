import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { TextInput, ConfirmInput, ValidationSummary } from '../ui/index.js';
import SelectInput from '../ui/SelectInput.js';
import zod from 'zod';
import {
  readSubmitConfig,
  authenticateGitHubWithToken,
  detectGitRemote,
  buildReviewPackage,
  updateSubmissionsIndex,
  markProjectCompleted,
  isInsideMonorepo,
} from '../actions/submit.js';
import type { SubmitAnswers, BuildResult } from '../actions/submit.js';
import { runValidation } from '../actions/validate.js';
import type { ValidationResult } from '../actions/validate.js';
import { getSystemTracks, getTrackModules } from '../reader/lesson-reader.js';
import { API_BASE_URL } from '../config.js';

export const args = zod.tuple([
  zod.string().optional().describe('Optional system slug (auto-detected from 100xsystems.json)'),
]);

type Props = {
  args: zod.infer<typeof args>;
};

type SharedContext = {
  config: Record<string, any>;
  slug: string;
  projectDir: string;
  systemTitle: string;
};

type SubmitPhase =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'confirm'; ctx: SharedContext; results: ValidationResult[] }
  | { name: 'auth'; ctx: SharedContext }
  | { name: 'metadata'; ctx: SharedContext; user: string; defaultRepoUrl: string | null }
  | { name: 'building'; ctx: SharedContext; answers: SubmitAnswers; user: string }
  | { name: 'submission-link'; ctx: SharedContext; buildResult: BuildResult; user: string }
  | { name: 'submitting'; ctx: SharedContext; buildResult: BuildResult; submissionLink: string; liveLink?: string; user: string }
  | { name: 'done'; result: BuildResult; submissionLink: string; liveLink?: string };

export default function Submit({ args }: Props) {
  const [systemSlug] = args;
  const [phase, setPhase] = useState<SubmitPhase>({ name: 'loading' });
  const { exit } = useApp();

  // ─── Kick off loading ──────────────────────────────────────────

  useEffect(() => {
    if (phase.name !== 'loading') return;

    (async () => {
      const projectDir = process.cwd();
      const loaded = readSubmitConfig(projectDir, systemSlug);
      if (!loaded) {
        setPhase({ name: 'error', message: 'No 100xsystems.json found. Run `100x init <system>` first.' });
        return;
      }

      const { config, slug } = loaded;
      const systemTitle = (config.systemTitle as string) || slug;
      const ctx: SharedContext = { config, slug, projectDir, systemTitle };

      const results = await runValidation(projectDir, config);

      const progress = config.progress || {};
      const completed: string[] = progress.completedLessons || [];
      const trackSlug = (config.track as string) || '';

      if (trackSlug) {
        const modules = getTrackModules(slug, trackSlug);
        const allLessons = modules.flatMap(m => m.lessons);
        if (allLessons.length > 0) {
          const allCompleted = allLessons.every(l => completed.includes(l.slug));
          if (!allCompleted) {
            results.unshift({
              check: 'completeness',
              status: 'warn',
              message: `Not all lessons completed. ${completed.length}/${allLessons.length} done.`,
              category: 'validation',
            });
          }
        }
      }

      setPhase({ name: 'confirm', ctx, results });
    })();
  }, [phase]);

  // ─── Confirm → Auth transition ─────────────────────────────────

  const handleConfirm = useCallback((confirmed: boolean) => {
    if (!confirmed) {
      setPhase({ name: 'error', message: 'Submission cancelled.' });
      return;
    }
    setPhase((p) => {
      if (p.name !== 'confirm') return p;
      return { name: 'auth', ctx: p.ctx };
    });
  }, []);

  // ─── Auth → Metadata transition ────────────────────────────────

  useEffect(() => {
    if (phase.name !== 'auth') return;

    (async () => {
      try {
        const auth = await authenticateGitHubWithToken();
        const p = phase as Extract<SubmitPhase, { name: 'auth' }>;
        const defaultRepoUrl = detectGitRemote(p.ctx.projectDir);
        setPhase({ name: 'metadata', ctx: p.ctx, user: auth.user, defaultRepoUrl });
        // Store token in context for later use
        (p.ctx as any)._token = auth.token;
      } catch (err: any) {
        setPhase({ name: 'error', message: `Authentication failed: ${err.message}` });
      }
    })();
  }, [phase]);

  // ─── Metadata → Building transition ────────────────────────────

  const handleMetadata = useCallback((answers: SubmitAnswers) => {
    setPhase((p) => {
      if (p.name !== 'metadata') return p;
      return { name: 'building', ctx: p.ctx, answers, user: p.user };
    });
  }, []);

  // ─── Building → Submission Link transition ─────────────────────

  useEffect(() => {
    if (phase.name !== 'building') return;

    (async () => {
      try {
        const p = phase as Extract<SubmitPhase, { name: 'building' }>;
        const { answers, user } = p;
        const { projectDir, slug } = p.ctx;
        const result = buildReviewPackage(projectDir, slug, user, answers);
        updateSubmissionsIndex(slug, result.metadata);
        setPhase({ name: 'submission-link', ctx: p.ctx, buildResult: result, user });
      } catch (err: any) {
        setPhase({ name: 'error', message: `Failed to build review package: ${err.message}` });
      }
    })();
  }, [phase]);

  // ─── Handle submission link input → API call ───────────────────

  const handleSubmissionLink = useCallback((link: string, liveLink?: string) => {
    setPhase((p) => {
      if (p.name !== 'submission-link') return p;
      return { name: 'submitting', ctx: p.ctx, buildResult: p.buildResult, submissionLink: link, liveLink, user: p.user };
    });
  }, []);

  // ─── Call API to record submission ─────────────────────────────

  useEffect(() => {
    if (phase.name !== 'submitting') return;

    (async () => {
      try {
        const p = phase as Extract<SubmitPhase, { name: 'submitting' }>;
        const { submissionLink, liveLink, user } = p;
        // Use the stored auth token from the metadata phase
        const token = (p.ctx as any)._token || '';
        const config = p.ctx.config;
        const trackSlug = (config.track as string) || '';
        const progress = config.progress || {};
        const completed: string[] = progress.completedLessons || [];
        const lastLesson = completed.length > 0 ? completed[completed.length - 1] : '';

        // Call the server API to record the submission with proper OAuth token
        const response = await fetch(`${API_BASE_URL}/api/cli/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            systemSlug: p.ctx.slug,
            trackSlug,
            lessonSlug: lastLesson,
            submissionLink,
            liveLink: liveLink || undefined,
          }),
        });

        if (!response.ok) {
          console.error(`  ⚠️  Failed to record submission on server: ${response.statusText}`);
        }

        markProjectCompleted(p.ctx.slug);
        setPhase({ name: 'done', result: p.buildResult, submissionLink, liveLink });
      } catch (err: any) {
        setPhase({ name: 'error', message: `Failed to submit: ${err.message}` });
      }
    })();
  }, [phase]);

  // ─── Auto-exit after done ──────────────────────────────────────

  useEffect(() => {
    if (phase.name === 'done') {
      const timer = setTimeout(() => exit(), 5000);
      return () => clearTimeout(timer);
    }
  }, [phase, exit]);

  // ─── Render per phase ──────────────────────────────────────────

  if (phase.name === 'error') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Box marginY={1}>
          {phase.message === 'Submission cancelled.' ? (
            <Text color="yellow">  {phase.message}</Text>
          ) : (
            <Text color="red">  {phase.message}</Text>
          )}
        </Box>
      </Box>
    );
  }

  if (phase.name === 'loading') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text>
          {'  '}<Spinner type="dots" />{' '}<Text dimColor>Loading project configuration...</Text>
        </Text>
      </Box>
    );
  }

  if (phase.name === 'confirm') {
    const failCount = phase.results.filter(r => r.status === 'fail').length;
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold>{'  '}100xSystems — Submitting &ldquo;{phase.ctx.systemTitle}&rdquo;</Text>
        <Box marginY={1} />
        <ValidationSummary results={phase.results} />
        <ConfirmInput
          message={'  Submit for review?' + (failCount > 0 ? ' (some checks failed)' : '')}
          defaultYes={failCount === 0}
          onConfirm={handleConfirm}
        />
      </Box>
    );
  }

  if (phase.name === 'auth') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text>
          {'  '}<Spinner type="dots" />{' '}<Text dimColor>Authenticating with GitHub...</Text>
        </Text>
      </Box>
    );
  }

  if (phase.name === 'metadata') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <MetadataForm
          defaultRepoUrl={phase.defaultRepoUrl || ''}
          defaultLanguage={(() => {
            const trackSlug = (phase.ctx.config.track as string) || '';
            const tracks = getSystemTracks(phase.ctx.slug);
            const track = tracks.find(t => t.slug === trackSlug);
            return track?.language || 'typescript';
          })()}
          defaultDifficulty="Intermediate"
          onComplete={handleMetadata}
        />
      </Box>
    );
  }

  if (phase.name === 'building') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text>
          {'  '}<Spinner type="dots" />{' '}<Text dimColor>Building review package...</Text>
        </Text>
      </Box>
    );
  }

  if (phase.name === 'submission-link') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color="green">{'  '}✓ Review package built!</Text>
        <Box marginY={1} />
        <SubmissionLinkForm onSubmit={handleSubmissionLink} />
      </Box>
    );
  }

  if (phase.name === 'submitting') {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text>
          {'  '}<Spinner type="dots" />{' '}<Text dimColor>Recording submission on server...</Text>
        </Text>
      </Box>
    );
  }

  if (phase.name === 'done') {
    return <DoneScreen result={phase.result} submissionLink={phase.submissionLink} liveLink={phase.liveLink} />;
  }

  return null;
}

// ─── Metadata Form ──────────────────────────────────────────────────

function MetadataForm({
  defaultRepoUrl,
  defaultLanguage,
  defaultDifficulty,
  onComplete,
}: {
  defaultRepoUrl: string;
  defaultLanguage: string;
  defaultDifficulty: string;
  onComplete: (answers: SubmitAnswers) => void;
}) {
  const [step, setStep] = useState<'repo-url' | 'language' | 'difficulty'>('repo-url');
  const [repoUrl, setRepoUrl] = useState(defaultRepoUrl);
  const [language, setLanguage] = useState(defaultLanguage);
  const [difficulty, setDifficulty] = useState(defaultDifficulty);

  const languageChoices = [
    { label: 'TypeScript', value: 'typescript' },
    { label: 'Java', value: 'java' },
    { label: 'Python', value: 'python' },
    { label: 'Go', value: 'go' },
    { label: 'Rust', value: 'rust' },
    { label: 'Other', value: 'other' },
  ];

  if (step === 'repo-url') {
    return (
      <TextInput
        message="Link to your implementation repository:"
        defaultValue={repoUrl}
        placeholder="https://github.com/your-username/your-repo"
        validate={(v: string) => v.length > 0 ? true : 'Repository URL is required'}
        onSubmit={(value) => {
          setRepoUrl(value);
          setStep('language');
        }}
      />
    );
  }

  if (step === 'language') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text>{'  '}Implementation language:</Text>
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <SelectInput
            items={languageChoices}
            onSelect={(item: { value: string }) => {
              setLanguage(item.value);
              setStep('difficulty');
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step === 'difficulty') {
    return (
      <TextInput
        message="Difficulty level (Beginner/Intermediate/Advanced):"
        defaultValue={difficulty}
        onSubmit={(value) => {
          setDifficulty(value);
          setTimeout(() => onComplete({ repositoryUrl: repoUrl, language, difficulty: value }), 0);
        }}
      />
    );
  }

  return null;
}

// ─── Submission Link Form ───────────────────────────────────────────

function SubmissionLinkForm({
  onSubmit,
}: {
  onSubmit: (link: string, liveLink?: string) => void;
}) {
  const [step, setStep] = useState<'submission-link' | 'live-link'>('submission-link');
  const [submissionLink, setSubmissionLink] = useState('');

  if (step === 'submission-link') {
    return (
      <TextInput
        message="Paste your submission URL (GitHub repo, PR, or hosted project):"
        defaultValue=""
        placeholder="https://github.com/your-username/your-implementation"
        validate={(v: string) => v.length > 0 ? true : 'Submission URL is required'}
        onSubmit={(value) => {
          setSubmissionLink(value);
          setStep('live-link');
        }}
      />
    );
  }

  if (step === 'live-link') {
    return (
      <TextInput
        message="(Optional) Paste your live project URL, or press Enter to skip:"
        defaultValue=""
        placeholder="https://your-app.vercel.app"
        onSubmit={(value) => {
          onSubmit(submissionLink, value || undefined);
        }}
      />
    );
  }

  return null;
}

// ─── Done Screen ────────────────────────────────────────────────────

function DoneScreen({ result, submissionLink, liveLink }: { result: BuildResult; submissionLink: string; liveLink?: string }) {
  const children: React.ReactNode[] = [];

  children.push(<Text key="h" color="green">{'  '}✓ Submission recorded successfully!</Text>);
  children.push(<Box key="sp0" marginY={1} />);
  children.push(<Text key="sl">{'  '}Submission URL: <Text bold color="cyan">{submissionLink}</Text></Text>);
  if (liveLink) {
    children.push(<Text key="ll">{'  '}Live URL: <Text bold color="cyan">{liveLink}</Text></Text>);
  }
  children.push(<Box key="sp1" marginY={1} />);

  children.push(<Text key="details-h" dimColor>{'  '}Submission details:</Text>);
  children.push(<Text key="d1">{'  '}System: <Text bold>{result.slug}</Text></Text>);
  children.push(<Text key="d2">{'  '}Author: <Text bold>{result.user}</Text></Text>);
  children.push(<Text key="d3">{'  '}Language: <Text bold>{result.metadata.language}</Text></Text>);
  children.push(<Text key="d4">{'  '}Repository: <Text bold>{result.metadata.repositoryUrl}</Text></Text>);
  children.push(<Box key="sp2" marginY={1} />);
  children.push(<Text key="note" dimColor>  Your submission has been recorded and is pending review.</Text>);

  return <Box flexDirection="column" paddingX={2}>{children}</Box>;
}

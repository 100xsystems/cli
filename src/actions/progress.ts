import fs from 'fs';
import path from 'path';
import { getTrackModules } from '../reader/lesson-reader.js';
import type { ProgressData, ProgressEntry } from '../reader/index.js';

const PROGRESS_DIR = () => path.resolve(process.env.HOME || process.env.USERPROFILE || '~', '.100x');
const PROGRESS_FILE = () => path.join(PROGRESS_DIR(), 'progress.json');

// ─── Public API (data-only — Pastel commands handle Ink display) ───

/**
 * Mark a system as in-progress.
 * Called by `100x init` automatically.
 */
export function markInProgress(systemSlug: string, projectDir: string, trackSlug?: string): void {
  const progress = loadProgress();
  const existing = progress.systems[systemSlug];

  progress.systems[systemSlug] = {
    status: existing?.status === 'completed' ? existing.status : 'in-progress',
    startedAt: existing?.startedAt || new Date().toISOString(),
    completedAt: existing?.completedAt,
    projectDir,
    language: trackSlug || existing?.language,
  };

  saveProgress(progress);
}

/**
 * Mark a system as completed.
 * Called by `100xsystems submit` after successful PR.
 */
export function markCompleted(systemSlug: string): void {
  const progress = loadProgress();
  const existing = progress.systems[systemSlug] || { status: 'not-started' as const };

  progress.systems[systemSlug] = {
    ...existing,
    status: 'completed',
    completedAt: new Date().toISOString(),
  };

  saveProgress(progress);
}

/**
 * Update the current lesson for a system.
 * Called by the validate command after successful validation or manually.
 */
export function updateCurrentLesson(systemSlug: string, lessonSlug: string): void {
  const progress = loadProgress();
  if (!progress.systems[systemSlug]) return;
  progress.systems[systemSlug] = {
    ...progress.systems[systemSlug],
    currentLesson: lessonSlug,
  };
  saveProgress(progress);
}

/**
 * Advance to the next lesson after the current one passes validation.
 * Returns the slug of the next lesson, or null if already on the last one.
 */
export function advanceLesson(systemSlug: string, trackSlug?: string): string | null {
  const progress = loadProgress();
  const entry = progress.systems[systemSlug];
  if (!entry) return null;

  // Use provided trackSlug or fall back to entry.language (which now stores track slug)
  const track = trackSlug || entry.language || '';
  if (!track) return null;

  const modules = getTrackModules(systemSlug, track);
  const allLessons = modules.flatMap(m => m.lessons);
  if (allLessons.length === 0) return null;

  const currentIdx = allLessons.findIndex(l => l.slug === entry.currentLesson);
  if (currentIdx === -1) {
    // Not on any lesson yet — start with the first
    const first = allLessons[0];
    updateCurrentLesson(systemSlug, first.slug);
    return first.slug;
  }

  if (currentIdx >= allLessons.length - 1) {
    // Already on the last lesson
    return null;
  }

  const next = allLessons[currentIdx + 1];
  updateCurrentLesson(systemSlug, next.slug);
  return next.slug;
}

// ─── Progress File I/O ──────────────────────────────────────────────

export function loadProgress(): ProgressData {
  try {
    if (!fs.existsSync(PROGRESS_FILE())) {
      return { systems: {} };
    }
    return JSON.parse(fs.readFileSync(PROGRESS_FILE(), 'utf-8')) as ProgressData;
  } catch {
    return { systems: {} };
  }
}

function saveProgress(data: ProgressData): void {
  try {
    if (!fs.existsSync(PROGRESS_DIR())) {
      fs.mkdirSync(PROGRESS_DIR(), { recursive: true });
    }
    fs.writeFileSync(PROGRESS_FILE(), JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Silently fail — progress tracking is non-critical
  }
}



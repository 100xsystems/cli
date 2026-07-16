/**
 * ## Quiz Reader
 *
 * Reads quiz data from the curriculum.
 * Supports two locations:
 *   1. `quizzes/` folder — top-level quiz files for a system
 *   2. Lesson directories — `track-x/module-x/quiz.md` embedded in lessons
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { parseFrontmatter, SYSTEMS_DIR } from './index.js';
import { getQuizzesDir, readFileContent } from './system-reader.js';
import { getSystemTracks, getTrackModules } from './lesson-reader.js';
import type { QuizData, QuizQuestion } from './index.js';

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get ALL quizzes for a system — both from the top-level quizzes/ folder
 * AND from lesson directories (track-x/module-x/quiz.md).
 *
 * Each quiz is tagged with its source location so the command can display
 * context about where it came from.
 */
export function getQuizzes(systemSlug: string): QuizData[] {
  const quizzes: QuizData[] = [];

  // 1. Quizzes from the top-level quizzes/ folder
  const folderQuizzes = getQuizzesFromFolder(systemSlug);
  quizzes.push(...folderQuizzes);

  // 2. Quizzes embedded in lesson directories
  const lessonQuizzes = getQuizzesFromLessons(systemSlug);
  quizzes.push(...lessonQuizzes);

  // Sort by order, then by title
  quizzes.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  return quizzes;
}

/**
 * Get a single quiz by its slug (from either source).
 */
export function getQuiz(systemSlug: string, quizSlug: string): QuizData | null {
  const quizzes = getQuizzes(systemSlug);
  return quizzes.find((q) => {
    const slug = q.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return slug === quizSlug;
  }) || null;
}

/**
 * Get ONLY quizzes embedded in lesson directories.
 */
export function getQuizzesFromLessons(systemSlug: string): QuizData[] {
  const quizzes: QuizData[] = [];
  const tracks = getSystemTracks(systemSlug);
  const systemsDir = SYSTEMS_DIR();

  for (const track of tracks) {
    const modules = getTrackModules(systemSlug, track.slug);
    for (const mod of modules) {
      const quizFilePath = path.join(systemsDir, systemSlug, track.slug, mod.slug, 'quiz.md');

      if (fs.existsSync(quizFilePath)) {
        const content = readFileContent(quizFilePath);
        if (content) {
          const { data } = parseFrontmatter(content);
          const fm = data as any;

          if (fm.questions && Array.isArray(fm.questions)) {
            const questions: QuizQuestion[] = fm.questions.map((q: any) => ({
              question: q.question || '',
              type: q.type || 'multiple-choice',
              choices: q.choices || undefined,
              answer: q.answer,
            }));

            quizzes.push({
              title: fm.title || `Quiz: ${mod.title}`,
              order: fm.order ?? mod.order,
              questions,
              _source: 'lesson',
              _track: track.title,
              _module: mod.title,
            } as QuizData & { _source: string; _track: string; _module: string });
          }
        }
      }
    }
  }

  return quizzes;
}

/**
 * Get ONLY quizzes from the top-level quizzes/ folder.
 */
export function getQuizzesFromFolder(systemSlug: string): QuizData[] {
  const quizzesDir = getQuizzesDir(systemSlug);
  if (!fs.existsSync(quizzesDir)) return [];

  const files = fs.readdirSync(quizzesDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const quizzes: QuizData[] = [];

  for (const filename of files) {
    const content = readFileContent(path.join(quizzesDir, filename));
    if (!content) continue;

    const { data } = parseFrontmatter(content);
    const fm = data as any;

    if (!fm.questions || !Array.isArray(fm.questions)) continue;

    const questions: QuizQuestion[] = fm.questions.map((q: any) => ({
      question: q.question || '',
      type: q.type || 'multiple-choice',
      choices: q.choices || undefined,
      answer: q.answer,
    }));

    quizzes.push({
      title: fm.title || filename.replace('.md', ''),
      order: fm.order || 999,
      questions,
      // Extra metadata
      _source: 'folder' as const,
    } as any);
  }

  return quizzes;
}

// ─── Backward Compatible Helpers ────────────────────────────────────

/**
 * Check if a system has any quizzes (from any source).
 */
export function hasQuizzes(systemSlug: string): boolean {
  return getQuizzes(systemSlug).length > 0;
}

/**
 * Count quizzes across both sources.
 */
export function countQuizzes(systemSlug: string): { folder: number; lessons: number; total: number } {
  const all = getQuizzes(systemSlug);
  const folder = getQuizzesFromFolder(systemSlug).length;
  const lessons = all.length - folder;
  return { folder, lessons, total: all.length };
}

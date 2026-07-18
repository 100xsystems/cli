/**
 * ## Lesson Reader
 *
 * Reads the lesson/track/module structure from the curriculum.
 * Parallel to website/src/lib/mdx.ts — keeps the CLI self-contained.
 * Used by `100xsystems learn`, `100xsystems review`, and `100xsystems quiz`.
 *
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import { SYSTEMS_DIR, isDirectory, slugToDisplayName, fileToSlug, getOrderFromFile, parseFrontmatter } from './index.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface TrackMeta {
  slug: string;
  title: string;
  language: string;
  difficulty: string;
}

export interface LessonMeta {
  slug: string;
  title: string;
  order: number;
  description: string;
  content: string;
  frontmatter: Record<string, any>;
  track: string;
  module: string;
  pathSegments: string[];
  estimatedTime?: string;
  difficulty?: string;
  knowledgeRefs?: string[];
  prerequisites?: string[];
}

export interface ModuleMeta {
  slug: string;
  title: string;
  order: number;
  lessons: LessonMeta[];
}

// ─── Track Reading ──────────────────────────────────────────────────

/**
 * Get all tracks for a system by scanning for track-* directories
 * and reading track metadata from index.md frontmatter.
 */
export function getSystemTracks(systemSlug: string): TrackMeta[] {
  const tracks: TrackMeta[] = [];
  const systemDir = path.join(SYSTEMS_DIR(), systemSlug);
  if (!fs.existsSync(systemDir)) return tracks;

  // Try reading track definitions from index.md frontmatter first
  const indexMdPath = path.join(systemDir, 'index.md');
  if (fs.existsSync(indexMdPath)) {
    try {
      const raw = fs.readFileSync(indexMdPath, 'utf-8');
      const { data } = parseFrontmatter(raw);
      const fm = data as any;
      if (fm.tracks && Array.isArray(fm.tracks)) {
        return fm.tracks.map((t: any) => ({
          slug: t.slug || '',
          title: t.title || slugToDisplayName(t.slug || ''),
          language: t.language || '',
          difficulty: t.difficulty || fm.difficulty || 'Intermediate',
        }));
      }
    } catch {}
  }

  // Fallback: scan for track-* directories
  try {
    const items = fs.readdirSync(systemDir).filter((name) => name.startsWith('track-'));
    items.sort().forEach((name) => {
      if (isDirectory(path.join(systemDir, name))) {
        tracks.push({
          slug: name,
          title: slugToDisplayName(name.replace(/^track-/, '')),
          language: name.replace(/^track-/, ''),
          difficulty: 'Intermediate',
        });
      }
    });
  } catch {}
  return tracks;
}

/**
 * Check if a system has tracks (new structure).
 */
export function systemHasTracks(systemSlug: string): boolean {
  return getSystemTracks(systemSlug).length > 0;
}

// ─── Lesson Reading (Flat + Module-based) ───────────────────────────

/**
 * Get lessons directly from a track directory (flat structure, no modules).
 * This is the NEW preferred structure:
 *   track-{lang}/
 *     lesson-name/
 *       lesson.md
 *       tests/
 *     quiz-name.md
 *     challenge-name.md
 */
export function getTrackFlatLessons(systemSlug: string, trackSlug: string): LessonMeta[] {
  const lessons: LessonMeta[] = [];
  const trackDir = path.join(SYSTEMS_DIR(), systemSlug, trackSlug);
  if (!fs.existsSync(trackDir)) return [];

  try {
    const entries = fs.readdirSync(trackDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'index.md') continue;

      let mdPath: string | null = null;
      let slug = '';

      if (entry.isDirectory()) {
        // Folder-based lesson: lesson-name/lesson.md
        const lessonMdPath = path.join(trackDir, entry.name, 'lesson.md');
        if (fs.existsSync(lessonMdPath)) {
          mdPath = lessonMdPath;
          slug = fileToSlug(entry.name);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Flat .md file: lesson-name.md or quiz.md, challenge.md
        mdPath = path.join(trackDir, entry.name);
        slug = fileToSlug(entry.name);
      }

      if (!mdPath) continue;

      try {
        const raw = fs.readFileSync(mdPath, 'utf-8');
        const { data, content } = parseFrontmatter(raw);
        const fm = data as any;
        const order = getOrderFromFile(entry.name, fm.order);
        lessons.push({
          slug,
          title: fm.title || slugToDisplayName(slug),
          order,
          description: fm.description || content.slice(0, 200).replace(/#+\s+/g, '').trim() + '...',
          content,
          frontmatter: fm,
          track: trackSlug,
          module: '',
          pathSegments: [trackSlug, slug],
          estimatedTime: fm.estimated_time,
          difficulty: fm.difficulty,
          knowledgeRefs: fm.knowledge_refs,
          prerequisites: fm.prerequisites,
        });
      } catch {}
    }
    lessons.sort((a, b) => a.order - b.order);
  } catch {}
  return lessons;
}

// ─── Module Reading (Legacy — backward compatible) ──────────────────

/**
 * Get all modules for a track by scanning module-* directories.
 * Kept for backward compatibility with older curriculum content.
 */
export function getTrackModules(systemSlug: string, trackSlug: string): ModuleMeta[] {
  const modules: ModuleMeta[] = [];
  const trackDir = path.join(SYSTEMS_DIR(), systemSlug, trackSlug);
  if (!fs.existsSync(trackDir)) return modules;

  // Check if this track uses flat structure (no module-* dirs) — if so, return empty
  const hasModuleDirs = fs.readdirSync(trackDir).some((name) => name.startsWith('module-'));
  if (!hasModuleDirs) return modules;

  try {
    const items = fs.readdirSync(trackDir).filter((name) => name.startsWith('module-')).sort();
    items.forEach((name) => {
      const moduleDir = path.join(trackDir, name);
      if (!isDirectory(moduleDir)) return;
      const lessons = getModuleLessons(systemSlug, trackSlug, name);
      modules.push({
        slug: name,
        title: (() => {
          const raw = name.replace(/^module-\d+-?/, '').replace(/[-_]/g, ' ').trim();
          return raw ? slugToDisplayName(raw) : `Module ${getOrderFromFile(name)}`;
        })(),
        order: getOrderFromFile(name),
        lessons,
      });
    });
  } catch {}
  return modules;
}

/**
 * Get all lessons for a module (legacy).
 */
export function getModuleLessons(systemSlug: string, trackSlug: string, moduleSlug: string): LessonMeta[] {
  const lessons: LessonMeta[] = [];
  const moduleDir = path.join(SYSTEMS_DIR(), systemSlug, trackSlug, moduleSlug);
  if (!fs.existsSync(moduleDir)) return lessons;

  try {
    const entries = fs.readdirSync(moduleDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'quiz.md' || entry.name === 'challenge.md') continue;

      let mdPath: string | null = null;
      let slug = '';

      if (entry.isDirectory()) {
        const lessonMdPath = path.join(moduleDir, entry.name, 'lesson.md');
        if (fs.existsSync(lessonMdPath)) {
          mdPath = lessonMdPath;
          slug = fileToSlug(entry.name);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stem = entry.name.replace(/\.md$/, '');
        const folderPath = path.join(moduleDir, stem);
        if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
          continue;
        }
        mdPath = path.join(moduleDir, entry.name);
        slug = fileToSlug(entry.name);
      }

      if (!mdPath) continue;

      try {
        const raw = fs.readFileSync(mdPath, 'utf-8');
        const { data, content } = parseFrontmatter(raw);
        const fm = data as any;
        const order = getOrderFromFile(entry.name, fm.order);
        lessons.push({
          slug,
          title: fm.title || slugToDisplayName(slug),
          order,
          description: fm.description || content.slice(0, 200).replace(/#+\s+/g, '').trim() + '...',
          content,
          frontmatter: fm,
          track: trackSlug,
          module: moduleSlug,
          pathSegments: [trackSlug, moduleSlug, slug],
          estimatedTime: fm.estimated_time,
          difficulty: fm.difficulty,
          knowledgeRefs: fm.knowledge_refs,
          prerequisites: fm.prerequisites,
        });
      } catch {}
    }
    lessons.sort((a, b) => a.order - b.order);
  } catch {}
  return lessons;
}

/**
 * Get all lessons across all tracks (flat structure preferred, module fallback).
 */
export function getAllSystemLessons(systemSlug: string): LessonMeta[] {
  const all: LessonMeta[] = [];
  const tracks = getSystemTracks(systemSlug);
  for (const track of tracks) {
    // Try flat lessons first
    const flatLessons = getTrackFlatLessons(systemSlug, track.slug);
    if (flatLessons.length > 0) {
      all.push(...flatLessons);
    } else {
      // Fallback to module-based lessons
      const modules = getTrackModules(systemSlug, track.slug);
      for (const mod of modules) {
        all.push(...mod.lessons);
      }
    }
  }
  return all.sort((a, b) => a.order - b.order);
}

/**
 * Get review criteria from a lesson's frontmatter.
 * Returns an array of { category, questions } objects.
 */
export function getLessonReviewCriteria(lesson: LessonMeta): ReviewCriteria[] {
  const fm = lesson.frontmatter;
  if (fm.review_criteria && Array.isArray(fm.review_criteria)) {
    return fm.review_criteria.map((rc: any) => ({
      category: rc.category || 'General',
      questions: rc.questions || [],
    }));
  }
  // Default criteria if none specified
  return [
    { category: 'Architecture', questions: ['Is the architecture well-documented?'] },
    { category: 'Implementation', questions: ['Does the implementation meet the requirements?'] },
    { category: 'Design Decisions', questions: ['Are design decisions justified?'] },
  ];
}

export interface ReviewCriteria {
  category: string;
  questions: string[];
}

import fs from 'fs';
import path from 'path';
import { SYSTEMS_DIR, isDirectory, slugToDisplayName, fileToSlug, getOrderFromFile, parseFrontmatter } from './index.js';
import type { SystemInfo, FolderTag, FolderEntry } from './index.js';

// ─── System Discovery ───────────────────────────────────────────────

export function getAllSystemSlugs(): string[] {
  try {
    const dir = SYSTEMS_DIR();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => isDirectory(path.join(dir, name)));
  } catch { return []; }
}

export function getSystemMeta(slug: string): SystemInfo | null {
  try {
    const systemDir = path.join(SYSTEMS_DIR(), slug);
    if (!fs.existsSync(systemDir)) return null;

    const indexMdPath = path.join(systemDir, 'index.md');
    let title = slugToDisplayName(slug);
    let description = '';
    let difficulty = 'Intermediate';
    let tags: string[] = [];
    let order = 999;

    if (fs.existsSync(indexMdPath)) {
      const raw = fs.readFileSync(indexMdPath, 'utf-8');
      const { data } = parseFrontmatter(raw);
      title = (data as any).title || title;
      description = (data as any).description || '';
      difficulty = (data as any).difficulty || difficulty;
      tags = (data as any).tags || [];
      order = (data as any).order ?? order;
    }

    return { slug, title, description, difficulty, tags, order };
  } catch { return null; }
}

export function getAllSystems(): SystemInfo[] {
  return getAllSystemSlugs()
    .map((slug) => getSystemMeta(slug))
    .filter((s): s is SystemInfo => s !== null)
    .sort((a, b) => a.order - b.order);
}

// ─── Folder Tags ────────────────────────────────────────────────────

export function getSystemFolderTags(systemSlug: string): FolderTag[] {
  const tags: FolderTag[] = [];
  try {
    const systemDir = path.join(SYSTEMS_DIR(), systemSlug);
    if (!fs.existsSync(systemDir)) return tags;

    const items = fs.readdirSync(systemDir).filter((name) => !name.startsWith('.'));
    const folderTags = items.filter((name) => isDirectory(path.join(systemDir, name))).sort();

    folderTags.forEach((tag) => {
      const tagDir = path.join(systemDir, tag);
      const children = readFolderEntries(tagDir);
      tags.push({ tag, displayName: slugToDisplayName(tag), children });
    });
  } catch {}
  return tags;
}

function readFolderEntries(dir: string): FolderEntry[] {
  const entries: FolderEntry[] = [];
  if (!fs.existsSync(dir)) return entries;

  try {
    const items = fs.readdirSync(dir).filter((name) => !name.startsWith('.'));

    const folders: { name: string; order: number }[] = [];
    const mdFiles: { name: string; order: number; data: Record<string, any> }[] = [];

    items.forEach((name) => {
      const fullPath = path.join(dir, name);
      if (isDirectory(fullPath)) {
        folders.push({ name, order: 999 });
      } else if (name.endsWith('.md')) {
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const { data } = parseFrontmatter(raw);
          mdFiles.push({ name, order: getOrderFromFile(name, (data as any).order), data });
        } catch {
          mdFiles.push({ name, order: getOrderFromFile(name), data: {} });
        }
      }
    });

    folders.sort((a, b) => a.name.localeCompare(b.name));
    mdFiles.sort((a, b) => a.order - b.order);

    folders.forEach((f) => {
      entries.push({ type: 'folder', slug: f.name, title: slugToDisplayName(f.name), order: f.order });
    });

    mdFiles.forEach((f) => {
      const slug = fileToSlug(f.name);
      entries.push({ type: 'file', slug, title: (f.data as any).title || slugToDisplayName(slug), order: f.order });
    });
  } catch {}

  return entries;
}

// ─── Content Reading ────────────────────────────────────────────────

export function getSpecDir(systemSlug: string): string {
  return path.join(SYSTEMS_DIR(), systemSlug, 'specification');
}

export function getQuizzesDir(systemSlug: string): string {
  return path.join(SYSTEMS_DIR(), systemSlug, 'quizzes');
}

export function getChallengesDir(systemSlug: string): string {
  return path.join(SYSTEMS_DIR(), systemSlug, 'challenges');
}

export function getImplementationDir(systemSlug: string): string {
  return path.join(SYSTEMS_DIR(), systemSlug, 'implementation');
}

export function readFileContent(filePath: string): string | null {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
}

export function systemExists(slug: string): boolean {
  return isDirectory(path.join(SYSTEMS_DIR(), slug));
}

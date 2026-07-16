import fs from 'fs';
import path from 'path';
import { SYSTEMS_DIR, parseFrontmatter, readMdFiles } from './index.js';
import type { SystemResources, ResourceCategory, ResourceLink } from './index.js';

/**
 * Read curated resources for a system.
 * Resources can be defined either as:
 *   - Individual .md files in resources/ folder (each file = one category)
 *   - A single resources.md with frontmatter containing resource lists
 */
export function getSystemResources(systemSlug: string): SystemResources | null {
  const resourcesDir = path.join(SYSTEMS_DIR(), systemSlug, 'resources');

  if (!fs.existsSync(resourcesDir)) {
    // Try a single resources.md file
    const resourcesFile = path.join(SYSTEMS_DIR(), systemSlug, 'resources.md');
    if (!fs.existsSync(resourcesFile)) return null;
    return readSingleResourceFile(systemSlug, resourcesFile);
  }

  return readResourceDirectory(systemSlug, resourcesDir);
}

function readResourceDirectory(systemSlug: string, dir: string): SystemResources {
  const categories: ResourceCategory[] = [];
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  for (const filename of files) {
    const filePath = path.join(dir, filename);
    const parsed = readMdFiles(dir).find((p) => p.filename === filename);
    if (!parsed) continue;

    const categoryName = parsed.data.category ||
      filename.replace(/\.md$/, '').replace(/^\d+[-_]/, '');
    const items: ResourceLink[] = parsed.data.resources || [];

    if (items.length > 0) {
      categories.push({ name: categoryName, items });
    }
  }

  return { system: systemSlug, categories };
}

function readSingleResourceFile(systemSlug: string, filePath: string): SystemResources | null {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data } = parseFrontmatter(raw);
  const categories: ResourceCategory[] = [];

  // Try to read categories from frontmatter
  if (data.categories && Array.isArray(data.categories)) {
    for (const cat of data.categories) {
      if (cat.name && cat.items) {
        categories.push({ name: cat.name, items: cat.items });
      }
    }
  }

  // If no structured categories, try to parse sections from markdown body
  if (categories.length === 0) {
    const body = raw.replace(/^---[\s\S]*?---\s*\n/, '');
    const sectionRegex = /##\s+(.+)\n([\s\S]*?)(?=\n##\s+|$)/g;
    let match;

    while ((match = sectionRegex.exec(body)) !== null) {
      const name = match[1].trim();
      const sectionBody = match[2].trim();
      const links = parseLinksFromMarkdown(sectionBody);
      if (links.length > 0) {
        categories.push({ name, items: links });
      }
    }
  }

  return categories.length > 0 ? { system: systemSlug, categories } : null;
}

function parseLinksFromMarkdown(body: string): ResourceLink[] {
  const items: ResourceLink[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = linkRegex.exec(body)) !== null) {
    const title = match[1].trim();
    const url = match[2].trim();
    items.push({
      title,
      url,
      type: inferResourceType(url, title),
      description: extractDescription(body, match.index),
    });
  }

  return items;
}

function inferResourceType(url: string, title: string): ResourceLink['type'] {
  const lower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  if (lower.includes('arxiv') || lower.includes('ieee') || titleLower.includes('paper'))
    return 'paper';
  if (lower.includes('youtube') || lower.includes('vimeo'))
    return 'video';
  if (lower.includes('docs.') || lower.includes('documentation'))
    return 'documentation';
  if (lower.includes('github') || lower.includes('npm') || lower.includes('crates.io'))
    return 'tool';
  if (titleLower.includes('blog') || lower.includes('medium') || lower.includes('dev.to'))
    return 'blog';
  return 'article';
}

function extractDescription(body: string, linkIndex: number): string | undefined {
  // Get text after the link on the same line
  const lineStart = body.lastIndexOf('\n', linkIndex) + 1;
  const lineEnd = body.indexOf('\n', linkIndex);
  const line = body.slice(lineStart, lineEnd !== -1 ? lineEnd : undefined).trim();
  const afterLink = line.slice(line.indexOf(')') + 1).trim();
  return afterLink.startsWith('—') || afterLink.startsWith('-')
    ? afterLink.replace(/^[—\-–]\s*/, '')
    : afterLink.length > 0
      ? afterLink
      : undefined;
}

/**
 * Get all systems that have resources defined.
 */
export function getSystemsWithResources(): string[] {
  const systemsDir = SYSTEMS_DIR();
  if (!fs.existsSync(systemsDir)) return [];

  return fs.readdirSync(systemsDir)
    .filter((name => {
      const systemDir = path.join(systemsDir, name);
      if (!fs.statSync(systemDir).isDirectory()) return false;
      return (
        fs.existsSync(path.join(systemDir, 'resources')) ||
        fs.existsSync(path.join(systemDir, 'resources.md'))
      );
    }))
    .sort();
}

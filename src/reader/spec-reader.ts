import fs from 'fs';
import path from 'path';
import { parseFrontmatter } from './index.js';
import { getSpecDir, readFileContent } from './system-reader.js';
import type { SpecData, SpecCheck } from './index.js';

/**
 * Read the specification from a system's specification/ folder.
 * Returns the first spec file found, or null.
 */
export function getSpec(systemSlug: string): SpecData | null {
  const specDir = getSpecDir(systemSlug);
  if (!fs.existsSync(specDir)) return null;

  const files = fs.readdirSync(specDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (files.length === 0) return null;

  const content = readFileContent(path.join(specDir, files[0]));
  if (!content) return null;

  const { data } = parseFrontmatter(content);
  const fm = data as any;

  return {
    title: fm.title || 'Untitled Spec',
    version: fm.version || '1.0',
    checks: fm.checks || [],
  };
}

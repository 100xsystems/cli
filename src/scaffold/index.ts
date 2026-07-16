import fs from 'fs';
import path from 'path';

const TEMPLATE_DIR = new URL('../templates', import.meta.url).pathname;

export interface ScaffoldOptions {
  targetDir: string;
  systemSlug: string;
  systemTitle: string;
  trackSlug: string;
  language: string;
  author?: string;
  specification?: string;
}

export const PROJECT_CONFIG = '100xsystems.json';

/**
 * Scaffold a new implementation project for a system.
 * Creates:
 *
 *   100xsystems.json     — Project config (track, progress, metadata)
 *   README.md            — Project overview
 *   src/                 — Code (from language template)
 */
export function scaffoldProject(options: ScaffoldOptions): string[] {
  const { targetDir, systemSlug, systemTitle, trackSlug, author } = options;
  const created: string[] = [];

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  // ─── 100xsystems.json ───────────────────────────────────────────

  const config = {
    _project: '100xsystems',
    _description: 'This file is managed by the 100xSystems CLI (https://github.com/100xsystems/100xsystems). It tracks your learning progress through systems engineering curriculum. Do not edit manually — use 100xsystems commands instead.',
    system: systemSlug,
    systemTitle,
    track: trackSlug,
    author: author || '',
    version: '0.1.0',
    createdAt: new Date().toISOString(),
    progress: {
      completedLessons: [] as string[],
      currentLesson: '',
    },
  };
  fs.writeFileSync(
    path.join(targetDir, PROJECT_CONFIG),
    JSON.stringify(config, null, 2) + '\n',
  );
  created.push(PROJECT_CONFIG);

  // ─── README ─────────────────────────────────────────────────────

  const readmeContent = `# ${systemTitle}\n\n> System: ${systemSlug} | Track: ${trackSlug}\n\n## Overview\n\n<!-- Describe what you built and your approach -->\n\n## What I Learned\n\n<!-- Key takeaways from this system -->\n`;
  fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);
  created.push('README.md');

  // ─── Language Templates ─────────────────────────────────────────

  copyLanguageTemplate(options.language, targetDir, created);

  return created;
}

function copyLanguageTemplate(language: string, targetDir: string, created: string[]) {
  const langTemplateDir = path.join(TEMPLATE_DIR, language);
  if (!fs.existsSync(langTemplateDir)) return;

  function walk(dir: string, relativePath: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relPath = relativePath ? `${relativePath}/${item}` : item;
      const targetPath = path.join(targetDir, relPath);

      if (fs.statSync(fullPath).isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        created.push(relPath + '/');
        walk(fullPath, relPath);
      } else {
        const content = fs.readFileSync(fullPath, 'utf-8');
        fs.writeFileSync(targetPath, content);
        created.push(relPath);
      }
    }
  }

  walk(langTemplateDir, '');
}

/**
 * Read the project config from a project directory.
 * Looks for 100xsystems.json first, falls back to .100x.json for backward compat.
 */
export function readProjectConfig(projectDir: string): Record<string, any> | null {
  try {
    // Try new name first
    let configPath = path.join(projectDir, PROJECT_CONFIG);
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    // Fallback to old name
    configPath = path.join(projectDir, '.100x.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    return null;
  } catch { return null; }
}

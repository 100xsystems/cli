# 100xSystems CLI — Complete Reference

> **Version:** 0.1.1 | **Binary:** `100x` or `100xsystems` | **Runtime:** Node.js 18+ | **Framework:** Pastel + Ink (React for CLIs)

---

## Table of Contents

| Command | Category | Description |
|---------|----------|-------------|
| [`init`](#100x-init) | Project | Scaffold a new implementation project |
| [`validate`](#100x-validate) | Verification | Pick a lesson and validate your code against it |
| [`submit`](#100x-submit) | Submission | Package and submit your implementation as a PR |
| [`list`](#100x-list) | Discovery | List all available systems or view one in detail |
| [`progress`](#100x-progress) | Tracking | Show per-lesson progress for your project |
| [`doctor`](#100x-doctor) | Environment | Check your development environment |
| [`contribute`](#100x-contribute) | Curriculum | Scaffold new curriculum content (systems, tracks, lessons) |
| [`login`](#100x-login) | Auth | Authenticate with GitHub |
| [`logout`](#100x-logout) | Auth | Clear authentication |
| [`auth`](#100x-auth) | Auth | Check authentication status |
| [`update`](#100x-update) | Maintenance | Check for CLI updates |

---

## Installation

```bash
npm install -g @100xsystems/cli
```

Or link from source:

```bash
cd cli/
npm run build
npm link
```

Verify:

```bash
100x --version
```

---

## 100x init

Scaffolds a new implementation project for a system. Creates a `100xsystems.json` config, a `README.md`, and language-specific starter code.

### Usage

```bash
# Interactive — pick system and track from a menu
100x init

# Direct — scaffold with first available track
100x init claude-code

# Custom output directory
100x init claude-code --output my-project

# Custom author
100x init claude-code --author your-github-username
```

### Options

| Flag | Alias | Description |
|------|-------|-------------|
| `--output` | `-o` | Output directory (default: `./<system>-implementation`) |
| `--author` | `-a` | Your GitHub username (used in templates) |

### What It Creates

```
claude-code-implementation/
├── 100xsystems.json    # Project config (system, track, progress)
├── README.md           # Project overview template
├── package.json        # Language-specific starter (from curriculum track)
├── src/
│   └── index.ts        # Starter code
└── tsconfig.json       # TypeScript config
```

### 100xsystems.json

This file is managed by the CLI. Do not edit manually.

```json
{
  "_project": "100xsystems",
  "_description": "This file is managed by the 100xSystems CLI (https://github.com/100xsystems/100xsystems). It tracks your learning progress through systems engineering curriculum. Do not edit manually — use 100x commands instead.",
  "system": "claude-code",
  "systemTitle": "Claude Code",
  "track": "track-typescript",
  "author": "your-github-username",
  "version": "0.1.0",
  "createdAt": "2026-07-16T00:00:00.000Z",
  "progress": {
    "completedLessons": [],
    "currentLesson": ""
  }
}
```

| Field | Description |
|-------|-------------|
| `_project` | Always `"100xsystems"` — identifies this as a 100xSystems project |
| `_description` | Human-readable explanation with GitHub link |
| `system` | System slug (e.g., `claude-code`, `microservices`) |
| `systemTitle` | Display name (e.g., `Claude Code`) |
| `track` | Track slug (e.g., `track-typescript`, `track-spring-boot`) |
| `author` | Your GitHub username |
| `progress.completedLessons` | Array of lesson slugs you've passed validation for |
| `progress.currentLesson` | Slug of the next lesson to work on |

### Interactive Flow

1. **Choose a System** — Select from available systems in the curriculum
2. **Choose a Track** — If the system has multiple tracks (e.g., TypeScript, Java), pick one
3. **Confirm** — Review system, track, and output directory
4. **Scaffold** — Files are created

### Notes

- The track determines which language templates are used (e.g., `track-typescript` uses TypeScript templates, `track-spring-boot` uses Java templates)
- Running `init` in a directory that already has files will fail — use `--output` to specify a different path
- Progress is automatically tracked in `100xsystems.json`

---

## 100x validate

Interactive lesson validator. Shows all lessons in your project's track, lets you pick one, and runs automated validation checks defined in the lesson's curriculum markdown.

### Usage

```bash
# Must be run inside a project directory with 100xsystems.json
cd my-project/
100x validate
```

### No Arguments

The command reads `100xsystems.json` to determine your system and track, then shows a lesson picker.

### What It Shows

```
📋 Claude Code — Lessons

Select a lesson to validate:

  ── Module 1: CLI Foundations ──
  ✓ Introduction & Project Setup       ← completed (green check)
  ▶ Build the CLI Tool                 ← current (cyan arrow, selectable)
  ○ The Agent Loop                     ← future (grey, disabled)
  ○ Implement File & System Tools      ← future

  ── Module 2: AI Integration ──
  ○ LLM API Integration                ← future
  ○ Context Window Management          ← future
```

### Lesson Status Icons

| Icon | Color | Meaning |
|------|-------|---------|
| `✓` | Green | Completed — can re-run to re-validate |
| `▶` | Cyan | Current — next lesson to validate |
| `○` | Grey | Future — locked until current passes |

### Validation Process

When you select a lesson:

1. The CLI reads the lesson's `validation:` block from the curriculum markdown
2. Each validator type is executed against your project directory
3. Results are displayed with pass/warn/fail status
4. If all checks pass, progress is auto-updated in `100xsystems.json`:
   - Lesson slug added to `completedLessons`
   - `currentLesson` advances to the next lesson

### Validation Result Output

```
📘 Validated: Build the CLI Tool
✓ Progress saved! Next lesson is now available.

3 passed · 1 warning

  100xSystems — Validating "Claude Code"

  Structure
  ✓ file exists: src/cli.ts
  ✓ file exists: package.json
  ✗ Required file/directory not found: src/agent/loop.ts

  ────────────────────────────────────────

  Validation Results: 3 passed, 1 failed
```

### What Happens on Success

- The lesson is marked completed in `100xsystems.json`
- The next lesson becomes the current one
- You see "✓ Progress saved!" confirmation

### What Happens on Failure

- Failed checks are shown with hints
- Progress is NOT updated — you must fix the issues and re-validate
- You can re-run validation on the same lesson any time

---

## 100x submit

Multi-step wizard that packages your implementation and creates a Pull Request for review.

### Usage

```bash
# Must be run inside a project directory with 100xsystems.json
cd my-project/
100x submit

# With explicit system slug
100x submit claude-code
```

### Flow

1. **Loading** — Reads `100xsystems.json`, runs validation
2. **Confirm** — Shows validation results, asks "Submit for review?"
3. **Auth** — Opens browser for GitHub OAuth (PKCE flow)
4. **Metadata** — Enter repository URL, language, difficulty
5. **Building** — Packages review documents into a submission directory
6. **Creating PR** — Forks `aryanbatras/submissions`, copies files, commits, pushes, creates PR
7. **Done** — Shows PR URL

### What Gets Submitted

The review package includes:

```
submissions/<system>/<user>-<language>-<timestamp>/
├── README.md                    # Your project overview
├── metadata.json                # Submission metadata
└── specification/
    └── SPECIFICATION.md         # System specification
```

### PR Output

```
✓ Pull Request created successfully!

→ https://github.com/aryanbatras/submissions/pull/42

Submission details:
System:    claude-code
Author:    your-username
Language:  typescript
Repository: https://github.com/your-username/your-repo
PR: #42
```

### Notes

- Requires GitHub authentication (runs `100x login` if not authenticated)
- The submissions repo is `aryanbatras/submissions` (configurable via `SUBMISSIONS_OWNER` env var)
- If PR creation fails, manual git instructions are shown

---

## 100x list

Lists all available systems or shows detailed info for a specific system.

### Usage

```bash
# List all systems
100x list

# Show details for a specific system
100x list claude-code
100x list microservices
```

### Output — All Systems

```
100xSystems — Available Systems

Claude Code
Learn to build an AI-powered coding agent that operates directly in your terminal
Advanced · AI · CLI · Tool Building

Microservices
Design, build, and deploy a microservices architecture
Advanced · Distributed Systems · Architecture
```

### Output — Specific System

```
Claude Code
Learn to build an AI-powered coding agent

AI · CLI · Tool Building

Tracks:
  TypeScript Track (track-typescript)
  Java Track (track-java)

100x init claude-code → start building
```

### Notes

- Systems are read from `curriculum/systems/` at runtime
- If a system doesn't exist, you'll see "System not found"

---

## 100x progress

Shows per-lesson progress for the current project. Must be run inside a project directory.

### Usage

```bash
cd my-project/
100x progress
```

### Output

```
📊 Claude Code — Progress

System: Claude Code
Track: track-typescript
Status: ▶ in-progress

Track: TypeScript Track — 2/7 lessons (29%)

  Module 1: CLI Foundations (2/4)
      ✓ Introduction & Project Setup
      ✓ Build the CLI Tool
      ▶ The Agent Loop  ← current
      ○ Implement File & System Tools

  Module 2: AI Integration (0/2)
      ○ LLM API Integration
      ○ Context Window Management

  Module 3: Tools & Plugins (0/1)
      ○ Building the Tool/Plugin System

Actions
100x validate  → pick a lesson to validate
100x submit  → submit for review
100x list claude-code → view system details
```

### Notes

- Reads progress directly from `100xsystems.json` in the current directory
- Shows completed (✓), current (▶), and future (○) lessons
- Displays completion percentage per module and overall

---

## 100x doctor

Checks your development environment for required and optional tools.

### Usage

```bash
# Check all tools
100x doctor

# Check tools relevant to a specific system
100x doctor claude-code
100x doctor microservices
```

### Output

```
100xSystems — Environment Doctor

✓ Node.js          v26.0.0
✓ Git              v2.50.1
✓ npm              v11.12.1
✓ TypeScript       v5.9.3
○ Docker           not found (optional)

────────────────────────────────────────
Summary:
3 required tools OK
Environment looks good!
1 optional tools found
```

### Tool Status Icons

| Icon | Meaning |
|------|---------|
| `✓` | Found with version |
| `✗` | NOT FOUND (required) — shown in red |
| `○` | not found (optional) — shown dimmed |

### System-Tool Mappings

| System | Tools Checked |
|--------|--------------|
| `claude-code` | Node.js, Git, npm, TypeScript, Docker |
| `microservices` | Node.js, Git, npm, Docker, Docker Compose |
| `kubernetes` | Node.js, Git, npm, Docker, kubectl, Docker Compose |
| `terraform` | Node.js, Git, npm, Terraform |
| `aws-infrastructure` | Node.js, Git, npm, AWS CLI, Terraform |

### Notes

- Without a system slug, checks all 14 tools
- Required tools (Node.js, Git, npm) are highlighted if missing
- Optional tools show "not found" without blocking

---

## 100x contribute

Scaffolds new curriculum content. Must be run from inside the 100xsystems monorepo.

### Usage

```bash
# Create a new system
100x contribute init my-system --title "My System" --description "Learn to build X" --difficulty Intermediate

# Add a language track to an existing system
100x contribute track my-system java --title "Java Track"

# Add a lesson to an existing track
100x contribute lesson my-system --language typescript --title "Docker Deployment" --description "Deploy with Docker"
```

### Sub-Commands

#### `contribute init`

Creates a full system directory structure:

```
curriculum/systems/my-system/
├── index.md                                    # System metadata (YAML frontmatter)
└── track-typescript/
    └── module-1-introduction/
        └── 01-lesson-introduction.md           # Lesson template
```

| Flag | Alias | Description |
|------|-------|-------------|
| `--title` | `-t` | System title |
| `--description` | `-d` | System description |
| `--difficulty` | `-D` | Beginner, Intermediate, or Advanced |
| `--language` | `-l` | Programming language for first track |
| `--tags` | `-g` | Comma-separated tags |

#### `contribute track`

Adds a new language track to an existing system:

```
curriculum/systems/my-system/
└── track-java/
    └── module-1-introduction/
        └── 01-lesson-introduction.md
```

#### `contribute lesson`

Adds a new module + lesson to an existing track:

```
curriculum/systems/my-system/track-typescript/
└── module-2-deployment/
    └── 01-lesson-docker-deployment.md
```

### Notes

- Must be run from inside the 100xsystems monorepo (checks for `curriculum/` directory)
- Generated files have YAML frontmatter with title, description, order, difficulty, estimated_time, knowledge_refs, prerequisites
- Lesson body includes sections: Overview, Key Concepts, Implementation, Exercises, Summary

---

## 100x login

Authenticates with GitHub via OAuth. Opens a browser for authorization.

### Usage

```bash
100x login

# Force re-authentication
100x login --force
100x login -f
```

### Flow

1. If already authenticated, shows your user info
2. If not (or `--force`), opens browser to GitHub OAuth
3. User authorizes in browser
4. Token is cached at `~/.100x/auth.json`

### Output — Already Authenticated

```
Authenticated as: Aryan Batra (aryanbatras)
Use 100x login --force to re-authenticate.
```

### Output — New Login

```
GitHub Authentication

A browser window will open to authorize 100xSystems.
If it doesn't open automatically, follow the URL shown above.
```

---

## 100x logout

Clears the cached GitHub authentication token.

### Usage

```bash
100x logout
```

### Output

```
Authentication cleared.
Run 100x login to authenticate again.
```

---

## 100x auth

Checks authentication status or logs out.

### Usage

```bash
# Show status (default)
100x auth

# Show status explicitly
100x auth status

# Logout
100x auth logout
```

### Output — Authenticated

```
Authenticated as: Aryan Batra (aryanbatras)
```

### Output — Not Authenticated

```
Not authenticated.
Run 100x submit to authenticate.
```

---

## 100x update

Checks if a newer version of the CLI is available on npm.

### Usage

```bash
100x update
```

### Output — Up to Date

```
✓ You're up to date!
Version: 0.1.1
```

### Output — Update Available

```
⟳ Update available!

Current: 0.1.1
Latest:  0.2.0

npm update -g @100xsystems/cli → upgrade
```

---

## Architecture

### How the CLI Reads the Curriculum

The CLI reads curriculum content directly from the filesystem at runtime. It finds the repo root by:

1. Checking `CURRICULUM_PATH` env var (overrides everything)
2. Walking up from cwd looking for a `curriculum/` directory
3. Checking if parent of cwd has `curriculum/`

```
100xsystems/
├── curriculum/                    # Source of truth
│   ├── systems/                   # System content
│   │   ├── claude-code/
│   │   │   ├── index.md           # System metadata
│   │   │   └── track-typescript/  # Language track
│   │   │       ├── module-1-*/    # Learning modules
│   │   │       │   ├── 01-lesson-*.md  # Lessons with validation rules
│   │   │       │   ├── quiz.md
│   │   │       │   └── challenge.md
│   │   │       └── module-2-*...
│   │   └── microservices/
│   ├── knowledge-base/            # Reference docs
│   │   ├── principles/            # CAP, SOLID, DRY, etc.
│   │   ├── patterns/              # Factory, Singleton, etc.
│   │   ├── tools/                 # Docker, Kubernetes, etc.
│   │   └── technologies/          # Kafka, Redis, etc.
│   └── search/                    # Curated resource JSONs
├── cli/                           # This CLI tool
└── website/                       # Next.js SSG site
```

### Executor Plugin System

The validation system uses a registry-based plugin architecture. Each executor type handles a specific kind of check.

| Executor | Type | What It Validates |
|----------|------|-------------------|
| FileExists | `file-exists` | File/directory exists, optional `min_size`, `must_contain` |
| FileContains | `file-contains` | File content matches `contains`, `pattern` (regex), or `does_not_contain` |
| Regex | `regex` | Regex matching on file contents |
| NpmTest | `npm-test` | Runs `npm run <script>`, checks exit code and test counts |
| CliCommand | `cli-command` | Runs arbitrary CLI commands |
| Docker | `docker` | Docker-related checks |
| Http | `http` | HTTP endpoint checks |

### Lesson Frontmatter Validation

Each lesson in the curriculum can define validation rules in its YAML frontmatter:

```yaml
---
title: "Build the CLI Tool"
order: 2
module: "CLI Foundations"
track: "typescript"
difficulty: "Beginner"
estimated_time: "45 min"
validation:
  - type: file-exists
    path: "src/cli.ts"
    must_contain: "Command"
  - type: file-contains
    path: "src/cli.ts"
    pattern: "command\\(|\\.command\\("
    description: "Has at least one commander subcommand"
  - type: npm-test
    script: "build"
    timeout: 60000
---
```

### How Validation Works End-to-End

1. User runs `100x validate`
2. CLI reads `100xsystems.json` → gets `system` and `track`
3. Finds the track directory in `curriculum/systems/<system>/<track>/`
4. Scans all lesson `.md` files for `validation:` blocks
5. Matches the selected lesson slug against found validators
6. For each validator, looks up the executor type from the registry
7. Executes each validator against the project directory
8. Returns sorted results (fails first, then warnings, then passes)
9. If all pass, updates `100xsystems.json` progress

### Submit PR Flow

```
100x submit
    │
    ├─ Read 100xsystems.json
    ├─ Run validation checks
    ├─ Confirm with user
    ├─ Authenticate with GitHub (PKCE OAuth)
    ├─ Collect metadata (repo URL, language, difficulty)
    ├─ Build review package → submissions/<system>/<user>-<lang>-<ts>/
    ├─ Fork aryanbatras/submissions
    ├─ Clone fork to temp dir
    ├─ Copy review package into fork
    ├─ Commit and push to branch
    ├─ Create PR against aryanbatras/submissions:main
    └─ Show PR URL
```

### Auth Storage

Authentication tokens are cached at `~/.100x/auth.json`:

```json
{
  "accessToken": "gho_...",
  "tokenType": "bearer",
  "scope": "repo,user:email",
  "createdAt": "2026-07-16T00:00:00.000Z",
  "user": {
    "login": "aryanbatras",
    "name": "Aryan Batra",
    "email": "",
    "avatarUrl": "https://avatars.githubusercontent.com/..."
  }
}
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CURRICULUM_PATH` | Override repo root for curriculum reading | Auto-detected |
| `SUBMISSIONS_OWNER` | GitHub owner for submissions repo | `aryanbatras` |
| `OPENAI_API_KEY` | API key for AI review (if implemented) | — |

---

## File Structure After `init`

```
my-project/
├── 100xsystems.json        # Project config — DO NOT EDIT
├── README.md               # Your project overview
├── package.json            # Starter package (from curriculum track)
├── tsconfig.json           # TypeScript config
└── src/
    └── index.ts            # Starter code
```

---

## Quick Start

```bash
# Install
npm install -g @100xsystems/cli

# Login
100x login

# See available systems
100x list

# Check your environment
100x doctor

# Start a system
100x init claude-code
cd claude-code-implementation

# Validate your work
100x validate

# Check progress
100x progress

# Submit for review
100x submit
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `No 100xsystems.json found` | Run `100x init <system>` first |
| `System not found` | Run `100x list` to see available systems |
| `No track found` | Ensure `100xsystems.json` has a valid `track` field |
| `No lessons found in track` | The curriculum may not have lessons for this track yet |
| `Authentication failed` | Run `100x login --force` to re-authenticate |
| `PR creation fails` | Check you have push access to the submissions repo |
| `npm run build failed` | The lesson validation checks your code — fix the failing checks |
| Curriculum not found | Set `CURRICULUM_PATH` env var to the repo root |

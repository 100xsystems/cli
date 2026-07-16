# 100xSystems CLI

The official command-line tool for 100xSystems — scaffold, validate, and submit systems engineering projects.

## Features

- **`init <system>`** — Scaffold a new project from any system in the registry
- **`validate`** — Run test suites against your implementation
- **`submit`** — Package and submit your code for review
- **`progress`** — Track completion across modules and lessons
- **`doctor`** — Check your development environment
- **`registry sync`** — Update local system repositories from the registry

## Installation

```bash
npm install -g @100xsystems/cli
```

## How Discovery Works

The CLI reads the [100xSystems Registry](https://github.com/100xsystems/registry) to discover available systems. When you run `init <system>`, it clones the system's repository into `~/.cache/100xsystems/repos/` for local validation.

## Quick Start

```bash
# See available systems
100xsystems list

# Scaffold a new project
100xsystems init claude-code --output my-agent

# Validate your implementation
cd my-agent
100xsystems validate

# Submit for review
100xsystems submit
```

## Development

```bash
npm run build
npm link
```

Set `CURRICULUM_PATH` to a local clone of a system repository to develop without network access.

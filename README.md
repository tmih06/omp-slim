# omp-slim

A custom build on top of [Pi](https://github.com/earendil-works/pi), focused on the frequently used features of [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi) without adopting its entire feature set.

The goal is a small, practical coding agent for everyday development: keep Pi as the foundation, bring over the OMP features we actually use, and avoid adding features just because upstream has them.

## Status

This fork currently contains Pi with these customizations:

- `omp-slim` CLI identity.
- Cache miss notices enabled by default.
- A minified, Bun-compiled executable build.
- Bun-managed dependencies and workspace scripts, with Oxfmt formatting and Oxlint linting.
- Linux and macOS build targets; no native Windows, Android, Nix, or p2 distribution.

OMP is not yet a dependency, and no OMP features have been ported yet. Feature selection and integration are the next steps. The current build still includes Pi's existing features; it is not yet a feature-trimmed distribution.

## Build

Requirements: Bun and Node.js 22.19 or newer. Bun manages the pinned workspace dependencies, runs the build, and compiles the executable.

From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run --bun build
cd packages/coding-agent
bun run --bun build:binary
```

The executable is written to:

```text
packages/coding-agent/dist/omp-slim
```

The binary build also copies runtime assets alongside the executable. Keep those assets with it; the executable alone is not the complete distribution.

The build uses `bun build --compile --minify --production`. This embeds the Bun runtime and bundled JavaScript, rather than compiling all application code to native machine code. Bytecode compilation is not enabled: Bun 1.4.2 crashed when building this application with `--bytecode`.

The initial Linux x64 executable measured **85.6 MiB**, excluding adjacent assets. Size will vary with Bun versions and included features.

## Usage

Run the executable from your project directory:

```sh
/path/to/omp-slim/packages/coding-agent/dist/omp-slim
```

Run `/login` to configure provider credentials, then enter a coding task. Use `--help` to see CLI options.

The fork retains Pi's configuration locations:

- User settings: `~/.pi/agent/settings.json`
- Project settings: `.pi/settings.json`

This means settings, credentials, and sessions can be shared with a Pi installation. Cache miss notices default to enabled; disable them with:

```json
{
  "showCacheMissNotices": false
}
```

Pi's extensions, skills, prompt templates, and themes remain available. See the [in-repository documentation](packages/coding-agent/docs/index.md) for inherited functionality. Those documents still use upstream Pi names and installation examples; they do not install this fork.

## Development

```sh
bun run build          # Refresh model data and build workspace packages
bun run build:offline  # Build using previously generated model data
bun run format         # Apply Oxfmt formatting
bun run lint           # Run Oxlint
bun run check          # Check formatting, lint, dependency policy, and types
```

`bun.lock` is the development dependency lockfile. `bunfig.toml` pins new direct dependencies exactly, disables install lifecycle scripts, and sets a two-day minimum release age for dependency resolution. CI uses frozen installs. The inherited npm installer lock under `packages/coding-agent/install-lock/` is a generated distribution artifact, now derived from `bun.lock`; it is not a second development lockfile.

Oxfmt and Oxlint check the package source/test scope. Import sorting stays disabled to avoid unnecessary import reordering. Deliberate test assertions and terminal control-character patterns retain documented lint exceptions.

Node remains required for Node-specific tests and two TypeScript 7 compiler-API checks that cannot run under Bun 1.4.2. Bun remains the package manager, build-script runner, and executable compiler. Inherited upstream npm publishing has not been migrated to the fork's build workflow.

Internal library package names retain their upstream `@earendil-works/*` identities. The user-facing application is `omp-slim`.

See [AGENTS.md](AGENTS.md) for development rules.

## Attribution and license

Built on [Pi](https://github.com/earendil-works/pi) by Mario Zechner and contributors. Feature direction is informed by [oh-my-pi](https://github.com/can1357/oh-my-pi). This is an independent custom build, not an official Pi or OMP release.

Licensed under [MIT](LICENSE). Upstream copyright notices are retained.

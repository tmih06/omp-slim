# omp-slim

A custom coding-agent build on top of [Pi](https://github.com/earendil-works/pi), focused on frequently used features from [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi) without adopting its entire feature set.

## Current customizations

- `omp-slim` CLI identity.
- Cache miss notices enabled by default.
- A throughput line after each run in interactive mode.
- A minified Bun executable build.

OMP integration is planned; no OMP features have been ported yet. The current build still includes Pi's existing features.

## Build and run

From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run --bun build
cd packages/coding-agent
bun run --bun build:binary
./dist/omp-slim
```

Keep the runtime assets copied into `dist/` alongside the executable. Run `/login` to configure provider credentials and `--help` to see CLI options.

The executable uses `--compile --minify --production`. Bytecode compilation is disabled because Bun 1.4.2 crashed when compiling this application with `--bytecode`.

## Configuration

User settings remain at `~/.pi/agent/settings.json`; project settings remain at `.pi/settings.json`. Credentials and sessions also use Pi's existing locations.

Override the user configuration directory with `OMP_SLIM_CODING_AGENT_DIR`, or the session directory with `OMP_SLIM_CODING_AGENT_SESSION_DIR`.

To disable cache miss notices:

```json
{
  "showCacheMissNotices": false
}
```

## Documentation

See the [repository README](../../README.md) for project goals and development instructions, and the [inherited Pi documentation](docs/index.md) for extensions, skills, tools, and provider configuration. Upstream installation instructions install Pi, not this fork.

Internal library package names retain their upstream `@earendil-works/*` identities.

## Attribution and license

Built on Pi by Mario Zechner and contributors, with feature direction informed by oh-my-pi. This is an independent custom build, not an official Pi or OMP release.

[MIT](../../LICENSE). Upstream copyright notices are retained.

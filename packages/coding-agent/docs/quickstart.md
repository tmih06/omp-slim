# omp-slim quickstart

omp-slim runs in a Linux or macOS terminal and works with files in your current directory. You need a supported model provider, subscription, API key, or local model.

## 1. Build

Install Bun 1.4.2 and Node.js 22.19 or newer, then run from the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run --cwd packages/coding-agent build:binary
```

The executable is `packages/coding-agent/dist/omp-slim`. Keep the adjacent assets with it when moving the distribution. See the [repository README](../../../README.md) for build details.

Upstream Pi installers and npm packages install Pi, not this fork.

## 2. Start

Change to the project you want to work on, then start the executable:

```sh
cd /path/to/project
/path/to/omp-slim/packages/coding-agent/dist/omp-slim
```

The working directory determines project instructions, configuration, and session grouping. Run `--help` for CLI options.

The remaining reference pages may use the upstream `pi` command; substitute `omp-slim` when running this fork.

## 3. Choose a model

Run:

```text
/login
```

Choose a provider and follow its prompts. Run `/model` to select a model. See [Models](models.md) for environment-variable authentication, local models, and custom endpoints.

## 4. Give it a task

For example:

```text
Explain how this repository is structured and how to run its checks.
```

Type `@` to attach a file. Review tool calls and changed files. Tools execute with your account's permissions; use version control and isolate untrusted work. See [Security](security.md).

## Continue later

Sessions are saved automatically. Resume the latest session for the current project with:

```sh
omp-slim --continue
```

Use the full executable path if it is not on `PATH`. Use `/resume` to choose a different session.

## Choose how to customize Pi

The inherited customization mechanisms remain available:

| Need | Reference |
|---|---|
| Persistent project instructions | [`AGENTS.md`](configuration.md#context-files) |
| Reusable prompts | [Prompt templates](prompt-templates.md) |
| Task-specific instructions | [Skills](skills.md) |
| Executable tools, commands, and hooks | [Extensions](extensions.md) |
| Terminal components | [Terminal UI](tui.md) |
| Additional model services | [Custom providers](custom-provider.md) |
| Bundled customization resources | [Packages](packages.md) |

## Update or remove

Update the source checkout and rebuild to update omp-slim. Upstream `pi update` and Pi's installers are not the fork's distribution mechanism.

To remove a local distribution, delete its executable, adjacent assets, and any launcher you created. Configuration, credentials, and sessions remain in `~/.pi/agent/`; do not delete that directory unless you also intend to remove shared Pi data.

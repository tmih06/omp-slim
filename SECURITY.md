# Security Policy

omp-slim is a local coding agent built on Pi. It runs with the permissions of the account that
started it and has no sandbox. Containing it is the user's job: run it in a container, virtual
machine, or other sandbox when the working folder, the model provider, or the prompt is not trusted.
See [Run Pi safely](packages/coding-agent/docs/security.md) and
[Run Pi in an isolated environment](packages/coding-agent/docs/containerization.md) for the limits of
each option.

## Trust boundary

omp-slim treats the local user account, and every file that account can write, as inside the same
trust boundary as the process. If an attacker can already write to a home directory, workspace,
shell startup file, environment variable, or omp-slim configuration, they can influence omp-slim and
the other developer tools on that machine.

Reports that depend on such prior local write access are not vulnerabilities unless they show how
omp-slim grants that access or crosses an operating-system privilege boundary.

omp-slim also relies on the user installing trustworthy extensions and skills and on working in
trusted repositories. Files such as `AGENTS.md`, repository instructions, tool output, and comments
can steer the model. That prompt-injection surface cannot be defended against by the agent.

## Reporting a vulnerability

Report privately through GitHub private vulnerability reporting on this repository (**Security** →
**Advisories** → **Report a vulnerability**). Do not open a public issue or describe the issue in a
comment for a security-sensitive report. If that entry point is unavailable, open an issue that only
asks for a private reporting channel and wait for a reply before sending details.

Include:

- A description of the issue and its impact
- Steps to reproduce, a proof of concept, or relevant logs
- Affected package, commit SHA, and configuration
- Any known mitigations

Vulnerabilities that also affect upstream Pi should be reported to
[earendil-works/pi](https://github.com/earendil-works/pi/security) as well; upstream's policy covers
its own infrastructure and release channels.

## In scope

- A bypass of the trust boundary above: actions that reach files, processes, credentials, or network
  destinations the user did not make available to omp-slim.
- Access gained through omp-slim that the operating-system user did not already have.
- Flaws in this repository's build, CI, or release automation that let unreviewed code, secrets, or
  unexpected files reach a distributed artifact.
- A vulnerability in a dependency shipped in this repository that is reachable through omp-slim with
  demonstrated impact.
- Stored provider credentials being sent somewhere other than the configured provider or endpoint
  without user action.

## Out of scope

- Local code execution and the absence of a sandbox. omp-slim intentionally executes what the model
  proposes with your permissions.
- Behavior of extensions, skills, packages, language servers, or other tools you choose to load or
  install.
- Risks from working in untrusted repositories, including instructions in their files, tool output,
  and model responses.
- Prompt injection of any kind.
- Malicious or incorrect model output.
- Reports that require the ability to create, modify, delete, or replace files, directories,
  symlinks, environment variables, shell configuration, or other user-controlled local state. This
  includes `~/.pi`, `~/.pi/agent/models.json`, workspace files, `AGENTS.md`, skills, extensions,
  extension configuration, dotfiles, and files synchronized by NFS, roaming profiles, or dotfile
  managers, unless the report shows how omp-slim itself grants that access.
- Issues caused by intentionally weakened configuration.
- Denial-of-service claims that need trusted local input or configuration.
- User-approved or user-initiated local actions presented as vulnerabilities.
- Public exposure of a locally running omp-slim instance or its RPC endpoint.
- Third-party or user-controlled credentials, including any secret that does not grant access to
  this repository, its releases, or its maintainer's accounts.
- Issues that reproduce on Pi itself without changes from this fork; report those to upstream.

## Notes for reporters

The useful reports show a current, reproducible boundary bypass with demonstrated impact. Reports
that only show expected local-agent behavior, prompt injection, or a malicious trusted extension do
not describe a vulnerability under this model. For example, malicious content written into a trusted
configuration file that then makes omp-slim execute commands or send credentials elsewhere is out of
scope, because writing that file already required the access the report would need to demonstrate.

Include the exact path, the commit SHA on `omp-slim` you tested, and the configuration in use, with
a proof of concept against the latest commit. For dependency reports, show that the affected code is
shipped and reachable through omp-slim.

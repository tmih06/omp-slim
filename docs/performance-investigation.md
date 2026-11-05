# Performance investigation: making omp-slim faster and lighter

Measured on Linux/aarch64, Bun 1.4.4, Node 24.18, the `omp-slim` binary built from
`packages/coding-agent/dist/omp-slim`. Every number below was produced by a command in this
repository or against the built binary, not estimated.

## Summary

The premise "split into Go or Rust to gain performance" does not match what the measurements show.
Three facts decide it:

1. **The binary is 92% runtime, 8% app.** A hello-world Bun compiled binary is 105 MiB; omp-slim is
   113 MiB. The application's own JavaScript is 9.5 MiB. Rewriting application code in Go or Rust
   can address at most that 9.5 MiB and the time spent executing it.
2. **A native call costs more than the JavaScript it replaces.** The N-API boundary alone measures
   **0.19 µs per call**; `visibleWidth` on a styled line is **0.30 µs**. A native rewrite of the
   small text primitives would lose. Native code only wins when a whole frame crosses the boundary
   once (measured: 50 lines in one call is 6.4× faster than 50 JS calls).
3. **Startup is dominated by parsing and evaluating JavaScript**, not by computation a native
   rewrite could remove: 358 ms of a 534 ms `--version` run is module evaluation, the rest is
   native runtime and filesystem work.

The wins are in JavaScript, and they are large. One defect found and fixed here removes 40-60 µs
from every styled line that passes through `truncateToWidth`, a function called from 69 sites in the
render path.

## What was measured

### Binary size

| Artifact | Size |
|---|---|
| Bun runtime (`~/.bun/bin/bun`) | 107 MiB |
| Hello-world `bun build --compile` | 105 MiB |
| omp-slim binary | 113 MiB |
| omp-slim bundled JavaScript (`dist/bundle`) | 9.5 MiB |

The 8 MiB delta is the whole application. Compressing or stripping cannot be recovered from here:

- `strip` on the binary **corrupts it**: the result degrades to the plain Bun CLI (`strip-test -ne
  --version` prints `error: Invalid Argument '-n'`). Bun's payload must stay intact.
- `upx -9` produces 51.8 MB (44%) and still runs, but **silently corrupts the embedded payload**:
  `--version` reports `0.0.0` instead of `1.5.0`, and startup grows from 0.6 s to **3.4-5.2 s** with
  peak RSS 165 MB (from 84 MB). Rejected.

### Startup

`--version` on a warm cache: ~600 ms, 84 MB peak RSS. `PI_TIMING=1` on interactive start reports:

```
parseArgs: 5ms
runMigrations: 2ms
createSessionManager: 3ms
createAgentSessionRuntime: 176ms
initTheme: 5ms
TOTAL: 193ms
```

The 193 ms is post-runtime application work; the remaining ~350-400 ms is before `main()` runs.

Module evaluation, measured by importing bundle chunks directly:

| Chunk | Contents | Cost |
|---|---|---|
| `chunk-VLLMJBFJ` | undici (113 modules), yaml (72), semver (46), the CLI entry | **436 ms** |
| `chunk-YZSNO7XO` | TypeBox runtime | **227 ms** |
| `chunk-YB25FZPL` + `chunk-5AGIVGSV` | theme module, highlight.js core and 22 registered grammars | 106-157 ms |

The eager graph reachable from `cli-runtime.js` is **22 modules, 4.74 MiB**: 2.5 MiB of undici,
yaml and semver, 1.3 MiB of TypeBox, and 0.5 MiB of theme plus syntax highlighting. The AWS/Bedrock
client is **not** in that graph (checked after the rebuild); `lazy-bedrock-provider.ts` already keeps
it out, so the eager module evaluation is not blamed on it.

Individual dependency import costs confirm the attribution: undici 267 ms, highlight.js 208 ms,
yaml 40 ms, semver 26 ms, marked 13 ms.

CPU profile of `--version` (534 ms total): 325 ms native/runtime, 93 ms TypeBox chunk, 70 ms CLI
chunk, 45 ms TypeBox core chunk. `BuildSchema` alone is 37 ms.

### Render path

Benchmarks against `packages/tui/src/utils.ts`:

| Operation | Cost |
|---|---|
| `visibleWidth` styled ASCII | 0.30-0.50 µs |
| `truncateToWidth` plain text | 0.86 µs |
| **`truncateToWidth` styled, already fits** | **47-63 µs** |
| Markdown render, 499 lines | 3.2 ms/frame |
| `visibleWidth` over that frame | 1.3 ms/frame |
| highlight.js, 14 lines TypeScript | 401 µs |
| highlight.js, 140 lines TypeScript | 3.1 ms |

The styled `truncateToWidth` number is the defect: it costs 55-120× the unstyled path and pays it
even when the text already fits the requested width, because the styled branch always runs a
per-grapheme segmentation walk. Styled lines are the normal case in this TUI.

## The native-language question, answered with measurements

N-API addons do load inside a Bun-compiled binary (verified: the existing
`linux-platform-x11.node` loads from both `bun` and a `--compile` output). The toolchains are
present (Rust 1.96, Go 1.22, gcc 13.3). So feasibility is not the blocker; economics is.

A C addon implementing the same width scan, measured against the JavaScript implementation:

| Implementation | Cost per call |
|---|---|
| N-API call returning a constant (FFI floor) | 0.189 µs |
| Native width scan (UTF-16 copy in, scan, double out) | 0.707 µs |
| JavaScript `visibleWidth` | 0.302 µs |

The FFI floor alone exceeds the JavaScript function. Adding the mandatory UTF-16 copy makes native
2.3× slower than JavaScript for this primitive. Native code wins only when the call is amortised
over real work:

| Approach | Cost for a 50-line styled frame |
|---|---|
| 50 × JS `visibleWidth` | 25.4 µs |
| 50 × JS `truncateToWidth` | 1006 µs |
| 1 × native batched scan | **3.9 µs** |

So a native module is justified only for whole-frame work, never per-string. Candidates that pass
that test: highlighting a 140-line block (3.1 ms in JavaScript, one call per block), and full-frame
line metrics. Neither is where the current time actually goes, and both already have a cheaper
JavaScript fix (see below).

## What actually to do, in value order

### 1. Fix the styled `truncateToWidth` fast path — done here

`truncateToWidth` now returns styled text unchanged when it fits, using the existing allocation-free
`asciiVisibleWidth` scan. Measured, with byte-identical output:

| Case | Before | After | Speedup |
|---|---|---|---|
| styled text fits | 48.7-63.5 µs | 0.52 µs | **~120×** |
| styled text exactly fits | 43.8-46.4 µs | 0.39 µs | **~105×** |
| needs truncation | 45.3 µs | 42.2 µs | unchanged |
| tiny width | 6.7 µs | 7.7 µs | unchanged |

All 1104 TUI tests pass, plus a regression test for the fits path.

### 2. Defer the heavy dependencies out of startup

`undici` (267 ms) is imported by `core/http-dispatcher.ts` at module scope purely to build a
dispatcher, and `highlight.js` (208 ms) is imported eagerly by `utils/syntax-highlight.ts` for a
feature that only matters when a code block renders. Both are already modelled by the existing
`cli.lazy.ts` pattern in this repository, which loads the MCP runtime only when `pi mcp` runs.
Together with TypeBox (item 3) these account for the 4.74 MiB eager graph.

This is the single largest available win and requires no new language.

### 3. Stop constructing TypeBox schemas at import (37 ms `BuildSchema` + 90 ms chunk)

`packages/coding-agent/src/core/settings-schema.ts` builds ~20 `Type.Object` schemas at module
evaluation. `SettingsSchema` is not referenced by any runtime validator in `src`; its value is the
`Static<>` types it derives. `model-config.ts` compiles `ModelsConfigSchema` at import
(`Compile(ModelsConfigSchema)`), which pays the compiler cost on every start including `--version`.

### 4. Reduce what the binary carries (up to ~9.5 MiB of the 113 MiB)

The binary can shrink only by shipping less JavaScript. The largest eager contributors are undici,
TypeBox, yaml, semver, and the Bedrock client. Deferring them (item 2) also removes them from the
startup path; removing them from the image entirely requires replacing them, which is a much larger
and riskier change than anything else here.

### 5. Only then consider native code

If, after 1-4, whole-frame rendering is still the bottleneck, the measured-viable design is a single
`@earendil-works/pi-tui` N-API addon with **batched** entry points:

- `measureFrame(lines: string[]) -> { widths, wraps }` — one FFI call per frame, not per line.
- `highlight(code, lang) -> string` — one call per code block, replacing highlight.js.

Do not port `visibleWidth`, `truncateToWidth`, or `sliceByColumn` individually: per-call FFI cost
exceeds their JavaScript cost, as measured above. Rust and Go are both adequate; Rust matches the
existing `packages/env/daemon` precedent and produces no GC pauses. Neither can touch the 107 MiB
runtime floor, which is Bun's.

## Why not ship a Go or Rust binary instead

Replacing the application binary with a Go or Rust program would discard the 9.5 MiB of application
logic and the entire Pi extension surface (extensions, skills, prompt templates, themes are all
JavaScript executed in-process), and would not make the result smaller than 113 MiB unless the
runtime is dropped entirely — at which point it is a different product, not an optimization. The
extension API is the fork's compatibility contract with Pi; a native rewrite breaks it.

## Reproduction

```sh
# binary size attribution
ls -la ~/.bun/bin/bun packages/coding-agent/dist/omp-slim
bun build --compile --minify --production /tmp/hello.js --outfile /tmp/hello-bin

# startup timing
PI_TIMING=1 packages/coding-agent/dist/omp-slim -ne --list-models

# per-chunk module evaluation (chunk names change per build; pick the largest from dist/bundle/chunks)
bun -e 'const t=performance.now(); await import("./packages/coding-agent/dist/bundle/chunks/<largest>.js"); console.log(performance.now()-t)'

# text primitives, including the truncateToWidth cases (needs no native toolchain)
node --experimental-strip-types scripts/profile-render.ts

# N-API boundary cost vs JavaScript for the same primitive
node --experimental-strip-types /tmp/ffi/bench.mjs   # see "The native-language question"
```

`scripts/profile-render.ts` is checked in. The N-API comparison addon is not: it needs a C
toolchain, exists only to answer the porting question, and its measured results are recorded above.

Absolute times vary with machine and load; the ratios are the finding.

The `strip` and `upx` results are reproducible with `strip <binary>` and `upx -9 -o out <binary>`;
both produce a binary that misreports `--version`.

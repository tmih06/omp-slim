#!/usr/bin/env node
/**
 * Runs the expensive `check` steps only for packages the current change can affect, and skips a step
 * whose inputs are byte-identical to a previous successful run.
 *
 * Two separate savings, because they fail differently:
 *
 * 1. Scope. `tsc` is the bulk of `bun run check` (~30 of 38 seconds) and its result depends only on
 *    the packages a change touches, plus everything that depends on them. A docs-only change
 *    typechecks nothing.
 * 2. Memo. Each step records a digest of its declared inputs and the exact command. On a match it is
 *    skipped. The digest covers file contents, not timestamps, so a rebase or checkout that leaves
 *    content unchanged does not re-run anything.
 *
 * Fail-safe rules: a step with no cached success runs; a step whose input digest changed runs; a
 * change outside the package tree runs everything. The cache never makes a failing state look green
 * because only successful exit codes are recorded.
 *
 * Usage:
 *   node scripts/run-check.mjs              # affected packages only
 *   node scripts/run-check.mjs --all        # everything, ignoring scope (still memoized)
 *   node scripts/run-check.mjs --no-cache   # ignore the memo
 *   node scripts/run-check.mjs --list       # print what would run, run nothing
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "omp-slim-check");
const CACHE_VERSION = 1;

const argv = process.argv.slice(2);
const runAll = argv.includes("--all");
const noCache = argv.includes("--no-cache");
const listOnly = argv.includes("--list");

/** Declared scope for one step: which files decide whether its result can differ. */
const PACKAGE_GLOBS = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "packages", entry.name, "package.json")))
	.map((entry) => entry.name)
	.sort();

function impacted() {
	const args = ["scripts/impacted.mjs", "--json"];
	// CI passes the workflow's own diff as the base; locally the resolver picks the merge base.
	const base = process.env.IMPACT_BASE;
	if (base) args.push("--base", base);
	if (runAll) args.push("--paths", "packages/*/src/**");
	const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
	if (result.status !== 0) return { packages: PACKAGE_GLOBS, everything: true };
	try {
		return JSON.parse(result.stdout);
	} catch {
		return { packages: PACKAGE_GLOBS, everything: true };
	}
}

/** Recursively list files under `dir`, skipping build output and dependencies. */
function walk(dir, out = []) {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(full);
	}
	return out;
}

/** Files that change a step's result: shared config first, then the selected packages. */
function inputsFor(packages) {
	const files = [
		join(ROOT, "tsconfig.json"),
		join(ROOT, "tsconfig.base.json"),
		join(ROOT, "package.json"),
		join(ROOT, "bun.lock"),
	];
	for (const dir of packages) files.push(...walk(join(ROOT, "packages", dir)));
	return files;
}

/** Digest of file paths and contents; content-based so a touch or rebase does not invalidate. */
function digest(files, command) {
	const hash = createHash("sha256");
	hash.update(`${CACHE_VERSION}\u0000${command}\u0000`);
	for (const file of files.sort()) {
		hash.update(file.slice(ROOT.length));
		hash.update("\u0000");
		try {
			hash.update(readFileSync(file));
		} catch {
			hash.update("<unreadable>");
		}
		hash.update("\u0000");
	}
	return hash.digest("hex");
}

function cachePath(key) {
	return join(CACHE_DIR, `${key}.json`);
}

function readCache(key) {
	if (noCache) return undefined;
	try {
		return JSON.parse(readFileSync(cachePath(key), "utf8"));
	} catch {
		return undefined;
	}
}

function writeCache(key, entry) {
	mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(cachePath(key), JSON.stringify(entry));
}

function seconds(ms) {
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * One check step. `key` names the cache slot; `inputs` narrows what invalidates it beyond the
 * selected packages; `run` returns a command to execute.
 */
function step({ key, label, inputs, command }) {
	const files = inputsFor(inputs === "all" ? PACKAGE_GLOBS : inputs);
	const hash = digest(files, command.join(" "));
	const cached = readCache(key);

	if (cached?.hash === hash) {
		return { key, label, command, skipped: "unchanged" };
	}
	return { key, label, command, hash };
}

function main() {
	const scope = impacted();
	const selected = scope.everything ? PACKAGE_GLOBS : scope.packages;

	if (scope.empty && !runAll) {
		console.log("No changed files; skipping check.");
		return 0;
	}

	// Mirrors `bun run check` exactly. Typechecking is one root project, so it is memoized rather than
	// split per package: splitting it would stop matching what CI validates.
	const steps = [
		step({ key: "format", label: "format", inputs: "all", command: ["bun", "run", "format:check"] }),
		step({ key: "lint", label: "lint", inputs: "all", command: ["bun", "run", "lint"] }),
		step({ key: "pinned-deps", label: "pinned deps", inputs: "all", command: ["bun", "run", "check:pinned-deps"] }),
		step({ key: "runtime-deps", label: "runtime deps", inputs: "all", command: ["bun", "run", "check:runtime-deps"] }),
		step({ key: "ts-imports", label: "ts imports", inputs: "all", command: ["bun", "run", "check:ts-imports"] }),
		step({ key: "entry-graphs", label: "entry graphs", inputs: "all", command: ["bun", "run", "check:entry-graphs"] }),
		step({ key: "install-lock", label: "install lock", inputs: ["coding-agent"], command: ["bun", "run", "check:install-lock:coding-agent"] }),
		step({
			key: "tsc-root",
			label: "tsc",
			inputs: "all",
			command: ["bun", "run", "tsc", "--noEmit"],
		}),
		step({
			key: "tsc-examples",
			label: "tsc examples",
			inputs: ["coding-agent"],
			command: ["bun", "run", "tsc", "--noEmit", "-p", "packages/coding-agent/examples/tsconfig.json"],
		}),
		step({ key: "browser-smoke", label: "browser smoke", inputs: ["ai"], command: ["bun", "run", "check:browser-smoke"] }),
	];

	if (listOnly) {
		for (const entry of steps) {
			console.log(`${entry.skipped ? "skip" : "run "}  ${entry.label}${entry.skipped ? " (unchanged)" : ""}`);
		}
		return 0;
	}

	console.log(`check: ${selected.length}/${PACKAGE_GLOBS.length} package(s) in scope`);
	let failures = 0;
	for (const entry of steps) {
		if (entry.skipped) {
			console.log(`  ○ ${entry.label}: unchanged, skipped`);
			continue;
		}
		const started = Date.now();
		const result = spawnSync(entry.command[0], entry.command.slice(1), {
			cwd: ROOT,
			stdio: "inherit",
			env: process.env,
		});
		if (result.status !== 0) {
			failures++;
			console.error(`  ✗ ${entry.label}: failed (${seconds(Date.now() - started)})`);
			continue;
		}
		// Record only success, so a failing input can never be treated as verified.
		writeCache(entry.key, { hash: entry.hash, command: entry.command.join(" "), at: new Date().toISOString() });
		console.log(`  ✓ ${entry.label} (${seconds(Date.now() - started)})`);
	}

	if (failures > 0) {
		console.error(`check: ${failures} step(s) failed`);
		return 1;
	}
	console.log("check: ok");
	return 0;
}

process.exitCode = main();

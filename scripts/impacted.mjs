#!/usr/bin/env node
/**
 * Decides what a change can affect, so `check` and the test suites run only the parts that matter.
 *
 * The expensive steps here are typechecking and the per-package test suites, not the individual
 * lint/format passes: a full `bun run check` is ~38s, while the coding-agent suite alone is ~4.5
 * minutes. So this maps changed files to workspace packages, then follows the workspace dependency
 * graph forward — editing `packages/ai` affects `coding-agent`, `durable`, and `evals`, because they
 * compile against it.
 *
 * Fail-safe: anything not recognized as scoped (root config, scripts, workflows, unknown paths)
 * selects everything. A green run must never mean "the changed thing was skipped".
 *
 * Usage:
 *   node scripts/impacted.mjs                 # working tree vs the merge base
 *   node scripts/impacted.mjs --base <ref>    # explicit base
 *   node scripts/impacted.mjs --json          # machine-readable, for CI matrix output
 *   node scripts/impacted.mjs --paths a b c   # explicit file list instead of git
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Package directory names in dependency order, from the workspace manifests. */
function readPackages() {
	const packages = new Map();
	for (const entry of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = join(ROOT, "packages", entry.name, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const workspaceDeps = Object.keys({
			...manifest.dependencies,
			...manifest.devDependencies,
			...manifest.peerDependencies,
		})
			.filter((name) => name.startsWith("@earendil-works/"))
			.map((name) => name.slice("@earendil-works/".length).replace(/^pi-/, ""));
		packages.set(entry.name, { dir: entry.name, name: manifest.name, deps: workspaceDeps });
	}
	return packages;
}

function git(args) {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/**
 * Base to diff against.
 *
 * Locally the useful question is "what did I change", so the answer is the merge base with the
 * upstream branch for committed work, and `HEAD` covers uncommitted work through the explicit
 * `git diff` calls below. In CI the same command is given `--base <merge-base>` by the workflow.
 */
function defaultBase() {
	for (const candidate of ["origin/omp-slim", "origin/main", "omp-slim", "main"]) {
		try {
			git(["rev-parse", "--verify", "--quiet", candidate]);
		} catch {
			continue;
		}
		try {
			return git(["merge-base", "HEAD", candidate]);
		} catch {
			return candidate;
		}
	}
	return "HEAD";
}

/**
 * Changed files: the committed range from `base` to `HEAD`, plus uncommitted and untracked work.
 *
 * Diffing `base...HEAD` and `base` catches both branch commits and local edits without listing the
 * whole tree. When `base` is `HEAD` the first two are empty and the working-tree diffs carry the
 * change.
 */
function changedFiles(base) {
	const files = new Set();
	const ranges = base === "HEAD" ? [] : [`${base}...HEAD`, base];
	for (const range of ranges) {
		try {
			for (const file of git(["diff", "--name-only", range]).split("\n")) {
				if (file) files.add(file);
			}
		} catch {
			// A shallow clone may not have the base; callers fall back to a full run.
		}
	}
	for (const args of [["diff", "--name-only"], ["diff", "--name-only", "--cached"], ["ls-files", "--others", "--exclude-standard"]]) {
		try {
			for (const file of git(args).split("\n")) {
				if (file) files.add(file);
			}
		} catch {
			// An unreadable index means no extra files.
		}
	}
	return [...files].sort();
}

/**
 * Map one path to the packages whose results it can change.
 *
 * Returns `null` for "everything", which is the safe answer for shared inputs: a root config, a
 * script, a workflow, or any path outside the packages that must still be covered.
 */
function packagesForPath(path, packages) {
	const normalized = path.split(sep).join("/");

	const inside = /^packages\/([^/]+)\/(.*)$/u.exec(normalized);
	if (inside) {
		const [, dir, rest] = inside;
		const pkg = packages.get(dir);
		if (!pkg) return null;
		// Package-local docs and the changelog cannot change code behavior or its tests.
		if (/^(docs\/|CHANGELOG\.md$|README\.md$)/u.test(rest)) return new Set();
		return new Set([dir]);
	}

	// Root documentation changes no build input.
	if (/^(README\.md|CONTRIBUTING\.md|SECURITY\.md|AGENTS\.md|LICENSE)$/u.test(normalized)) return new Set();

	// Anything else at the root is a shared input: scripts, workflows, configs, lockfiles. Treat an
	// unknown path as everything rather than guessing it is inert.
	return null;
}

/** Packages affected by a change, following workspace dependencies forward. */
function affectedPackages(changed, packages) {
	const direct = new Set();
	for (const file of changed) {
		const mapped = packagesForPath(file, packages);
		if (mapped === null) return { packages: [...packages.keys()].sort(), everything: true };
		for (const dir of mapped) direct.add(dir);
	}

	// Transitive: a package is affected when anything it depends on changed.
	const affected = new Set(direct);
	let grew = true;
	while (grew) {
		grew = false;
		for (const [dir, pkg] of packages) {
			if (affected.has(dir)) continue;
			if (pkg.deps.some((dep) => affected.has(dep))) {
				affected.add(dir);
				grew = true;
			}
		}
	}
	return { packages: [...affected].sort(), everything: false };
}

function main() {
	const argv = process.argv.slice(2);
	const json = argv.includes("--json");
	const baseFlag = argv.indexOf("--base");
	const pathsFlag = argv.indexOf("--paths");

	const packages = readPackages();
	let changed;
	let base;
	if (pathsFlag !== -1) {
		changed = argv.slice(pathsFlag + 1).filter((arg) => !arg.startsWith("--"));
	} else {
		base = baseFlag !== -1 ? argv[baseFlag + 1] : defaultBase();
		changed = changedFiles(base);
	}

	const result = affectedPackages(changed, packages);
	const output = {
		base: base ?? null,
		changed,
		packages: result.packages,
		everything: result.everything,
		// Empty change set: nothing to do, and the caller may skip cheaply.
		empty: changed.length === 0,
	};

	if (json) {
		console.log(JSON.stringify(output));
		return;
	}
	if (output.empty) {
		console.log("No changed files.");
		return;
	}
	console.log(`${changed.length} changed file(s); affected packages: ${result.everything ? "all" : result.packages.join(", ") || "none"}`);
}

main();

export { affectedPackages, packagesForPath, readPackages };

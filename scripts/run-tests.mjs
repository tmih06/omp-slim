#!/usr/bin/env node
/**
 * Runs only the package test suites a change can affect, and skips a suite whose inputs already
 * passed.
 *
 * The coding-agent suite alone is ~4.5 minutes, so running it for a change to `packages/tui` wastes
 * almost all of that. Scope comes from `scripts/impacted.mjs`, which follows the workspace dependency
 * graph, so editing `packages/ai` still runs `coding-agent`, `durable`, and `evals`.
 *
 * The memo is deliberately coarse: one entry per package, keyed by the content of that package plus
 * everything it depends on. It is not per test file, because Vitest gives no cheap dependency map and
 * a wrong per-file map would silently skip coverage. Coarse means the worst case is running a suite
 * whose result did not change, never skipping one whose result did.
 *
 * Usage:
 *   node scripts/run-tests.mjs               # affected packages only
 *   node scripts/run-tests.mjs --all         # every package
 *   node scripts/run-tests.mjs --no-cache    # ignore the memo
 *   node scripts/run-tests.mjs --list        # print the plan, run nothing
 *   node scripts/run-tests.mjs --bail        # stop at the first failing package
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "omp-slim-tests");
const CACHE_VERSION = 1;

const argv = process.argv.slice(2);
const runAll = argv.includes("--all");
const noCache = argv.includes("--no-cache");
const listOnly = argv.includes("--list");
const bail = argv.includes("--bail");

function readPackages() {
	const packages = new Map();
	for (const entry of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = join(ROOT, "packages", entry.name, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (!manifest.scripts?.test) continue;
		const deps = Object.keys({
			...manifest.dependencies,
			...manifest.devDependencies,
			...manifest.peerDependencies,
		})
			.filter((name) => name.startsWith("@earendil-works/"))
			.map((name) => name.slice("@earendil-works/".length).replace(/^pi-/, ""));
		packages.set(entry.name, { dir: entry.name, test: manifest.scripts.test, deps });
	}
	return packages;
}

function impacted() {
	const args = ["scripts/impacted.mjs", "--json"];
	const base = process.env.IMPACT_BASE;
	// `--paths` lets a caller state the change set explicitly (package scripts pass their own files).
	const pathsFlag = argv.indexOf("--paths");
	if (pathsFlag !== -1) args.push("--paths", ...argv.slice(pathsFlag + 1).filter((a) => !a.startsWith("--")));
	else if (base) args.push("--base", base);
	if (runAll) args.push("--paths", "packages/*/src/**");
	const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
	if (result.status !== 0) return { packages: null, everything: true };
	try {
		return JSON.parse(result.stdout);
	} catch {
		return { packages: null, everything: true };
	}
}

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

/** Content digest over a package and its workspace dependencies; the suite's real inputs. */
function digestFor(dir, packages, command) {
	const visited = new Set();
	const collect = (name) => {
		if (visited.has(name)) return;
		visited.add(name);
		const pkg = packages.get(name);
		if (!pkg) return;
		for (const dep of pkg.deps) collect(dep);
	};
	collect(dir);

	const hash = createHash("sha256");
	hash.update(`${CACHE_VERSION}\u0000${dir}\u0000${command}\u0000`);
	hash.update(readFileSync(join(ROOT, "bun.lock")));
	for (const name of [...visited].sort()) {
		hash.update(name);
		for (const file of walk(join(ROOT, "packages", name)).sort()) {
			hash.update(file.slice(ROOT.length));
			try {
				hash.update(readFileSync(file));
			} catch {
				hash.update("<unreadable>");
			}
		}
	}
	return hash.digest("hex");
}

function readCache(key) {
	if (noCache) return undefined;
	try {
		return JSON.parse(readFileSync(join(CACHE_DIR, `${key}.json`), "utf8"));
	} catch {
		return undefined;
	}
}

function main() {
	const packages = readPackages();
	const scope = impacted();
	const selected = scope.everything || !scope.packages ? [...packages.keys()].sort() : scope.packages.filter((dir) => packages.has(dir));

	if (scope.empty && !runAll) {
		console.log("No changed files; skipping tests.");
		return 0;
	}

	const plan = selected.map((dir) => {
		const pkg = packages.get(dir);
		const hash = digestFor(dir, packages, pkg.test);
		const cached = readCache(dir);
		return { dir, test: pkg.test, hash, skipped: cached?.hash === hash };
	});

	if (listOnly) {
		for (const entry of plan) console.log(`${entry.skipped ? "skip" : "run "}  ${entry.dir}`);
		return 0;
	}

	console.log(`tests: ${plan.length}/${packages.size} package(s) in scope`);
	let failures = 0;
	let skipped = 0;
	for (const entry of plan) {
		if (entry.skipped) {
			skipped++;
			console.log(`  ○ ${entry.dir}: unchanged, skipped`);
			continue;
		}
		const started = Date.now();
		const result = spawnSync("bun", ["run", "--cwd", `packages/${entry.dir}`, "test"], {
			cwd: ROOT,
			stdio: "inherit",
			env: process.env,
		});
		const elapsed = ((Date.now() - started) / 1000).toFixed(1);
		if (result.status !== 0) {
			failures++;
			console.error(`  ✗ ${entry.dir}: failed (${elapsed}s)`);
			if (bail) break;
			continue;
		}
		mkdirSync(CACHE_DIR, { recursive: true });
		writeFileSync(join(CACHE_DIR, `${entry.dir}.json`), JSON.stringify({ hash: entry.hash, at: new Date().toISOString() }));
		console.log(`  ✓ ${entry.dir} (${elapsed}s)`);
	}

	if (failures > 0) {
		console.error(`tests: ${failures} package(s) failed`);
		return 1;
	}
	console.log(`tests: ok${skipped > 0 ? ` (${skipped} unchanged, skipped)` : ""}`);
	return 0;
}

process.exitCode = main();

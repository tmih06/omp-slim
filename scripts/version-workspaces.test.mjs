// Verify workspace version bumps stay local and never run lifecycle scripts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("bumps every workspace through Bun without changing the root or running version hooks", () => {
	const directory = mkdtempSync(join(tmpdir(), "omp-slim-version-"));
	try {
		mkdirSync(join(directory, "scripts"));
		copyFileSync(resolve("scripts/version-workspaces.mjs"), join(directory, "scripts/version-workspaces.mjs"));
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ name: "root", version: "0.0.1", workspaces: ["packages/*"] }),
		);
		const workspaces = { "": { name: "root" } };
		for (const [name, version] of [
			["first", "1.2.3"],
			["second", "2.3.4"],
		]) {
			mkdirSync(join(directory, "packages", name), { recursive: true });
			workspaces[`packages/${name}`] = { name, version };
			writeFileSync(
				join(directory, "packages", name, "package.json"),
				JSON.stringify({
					name,
					version,
					scripts: { preversion: "touch lifecycle-ran" },
				}),
			);
		}
		writeFileSync(join(directory, "bun.lock"), JSON.stringify({ lockfileVersion: 2, workspaces, packages: {} }));
		const result = spawnSync("bun", [join(directory, "scripts/version-workspaces.mjs"), "patch"], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version, "0.0.1");
		for (const [name, version] of [
			["first", "1.2.4"],
			["second", "2.3.5"],
		]) {
			assert.equal(
				JSON.parse(readFileSync(join(directory, "packages", name, "package.json"), "utf8")).version,
				version,
			);
			assert.equal(existsSync(join(directory, "packages", name, "lifecycle-ran")), false);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

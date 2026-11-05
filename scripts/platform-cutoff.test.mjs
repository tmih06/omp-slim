// Guard the fork's supported distribution files and build targets after platform removal.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const removedPaths = [
	"apps/p2",
	"flake.nix",
	"flake.lock",
	"nix",
	"pi-test.bat",
	"pi-test.ps1",
	"packages/tui/native/win32",
	"packages/coding-agent/docs/windows.md",
	"packages/coding-agent/docs/termux.md",
	"packages/coding-agent/docs/nvidia-rtx-llama-cpp.md",
	"scripts/update-model-catalog-pin.mjs",
	".github/workflows/nix.yml",
	".github/workflows/p2-cloud-bundle.yml",
];

test("removed distributions have no files or workspace/build registration", () => {
	for (const path of removedPaths) assert.equal(existsSync(join(root, path)), false, path);
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	assert.equal(manifest.workspaces.includes("apps/*"), false);
	assert.equal(Object.hasOwn(manifest.scripts, "build:native:win32"), false);
	assert.equal(Object.hasOwn(manifest.scripts, "update:model-catalog-pin"), false);
	assert.doesNotMatch(readFileSync(join(root, "bun.lock"), "utf8"), /"apps\/p2"/);
	const tui = JSON.parse(readFileSync(join(root, "packages/tui/package.json"), "utf8"));
	assert.equal(
		tui.files.some((path) => path.includes("win32")),
		false,
	);
});

for (const platform of ["windows-x64", "windows-arm64", "android-arm64", "android-x64"]) {
	test(`binary build rejects ${platform} before installing or building`, () => {
		const result = spawnSync(
			"bash",
			["scripts/build-binaries.sh", "--skip-install", "--skip-build", "--platform", platform],
			{
				cwd: root,
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stdout, /Invalid platform/);
	});
}

test("workflows parse and do not schedule removed platforms or the removed app", () => {
	for (const name of readdirSync(join(root, ".github/workflows"))) {
		if (!name.endsWith(".yml")) continue;
		const source = readFileSync(join(root, ".github/workflows", name), "utf8");
		assert.ok(parse(source).jobs, name);
		assert.doesNotMatch(
			source,
			/windows-latest|windows-11-arm|linux-android|android-arm64|android-x64|apps\/p2/,
			name,
		);
	}
});

test("documentation navigation contains only retained reference pages", () => {
	const directory = join(root, "packages/coding-agent/docs");
	const { navigation } = JSON.parse(readFileSync(join(directory, "docs.json"), "utf8"));
	function check(items) {
		for (const item of items) {
			if (item.path) assert.ok(existsSync(join(directory, item.path)), item.path);
			if (item.items) check(item.items);
		}
	}
	check(navigation);
});

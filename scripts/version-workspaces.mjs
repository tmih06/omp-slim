// Apply the same version operation to each workspace without creating git tags or running lifecycle scripts.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const version = process.argv[2];
if (!version) {
	console.error("Usage: bun scripts/version-workspaces.mjs <patch|minor|major|version>");
	process.exit(1);
}
const lock = Bun.JSONC.parse(readFileSync(resolve(root, "bun.lock"), "utf8"));
for (const workspace of Object.keys(lock.workspaces)) {
	if (!workspace) continue;
	const result = spawnSync(process.execPath, ["pm", "version", version, "--no-git-tag-version", "--ignore-scripts"], {
		cwd: resolve(root, workspace),
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

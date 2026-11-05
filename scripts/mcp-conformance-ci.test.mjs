// Keep CI on the pinned Bun runtime, including the MCP conformance launcher.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));

test("every CI job installs the Bun version pinned by the project", () => {
	assert.match(manifest.packageManager, /^bun@\d+\.\d+\.\d+$/);
	const version = manifest.packageManager.slice("bun@".length);
	for (const [name, job] of Object.entries(workflow.jobs)) {
		const setup = job.steps.find((step) => step.uses?.startsWith("oven-sh/setup-bun@"));
		assert.ok(setup, `${name} must install Bun`);
		assert.equal(setup.with["bun-version"], version, `${name} must use the pinned Bun`);
	}
});

test("MCP conformance runs with Bun in CI and the workspace command", () => {
	assert.equal(manifest.scripts["test:mcp-conformance"], "bun packages/coding-agent/test/mcp-conformance/run.ts");
	assert.ok(workflow.jobs["mcp-conformance"].steps.some((step) => step.run === "bun run test:mcp-conformance"));
});

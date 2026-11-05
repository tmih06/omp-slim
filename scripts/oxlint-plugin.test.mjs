// Verify that Oxlint preserves the upstream chat-model comparison policy.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("rejects direct chat comparisons but permits model-type helpers and other labels", () => {
	const directory = mkdtempSync(join(tmpdir(), "omp-slim-lint-"));
	try {
		const path = join(directory, "models.ts");
		writeFileSync(
			path,
			[
				'const model = { type: "chat" };',
				'export const a = model.type === "chat";',
				'export const b = "chat" !== model.type;',
				'export const c = model.type == "chat";',
				'export const d = "chat" != model.type;',
				'export const e = model.type === "image";',
				"declare function isModelType(model: unknown, type: string): boolean;",
				'export const f = isModelType(model, "chat");',
			].join("\n"),
		);
		const result = spawnSync(
			process.execPath,
			[resolve("node_modules/oxlint/bin/oxlint"), "--config", resolve(".oxlintrc.json"), "--format", "json", path],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1, result.stderr);
		const diagnostics = JSON.parse(result.stdout).diagnostics;
		assert.equal(diagnostics.length, 4);
		assert.ok(diagnostics.every((diagnostic) => diagnostic.message.includes("Chat models may omit type")));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

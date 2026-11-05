// Verify registry, nested, and workspace resolution when deriving the installer lock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toNpmLockPackages } from "./bun-lock.mjs";

test("converts Bun workspace paths, scoped registry entries, and optional peers", () => {
	const result = toNpmLockPackages({
		lockfileVersion: 2,
		workspaces: { "": { name: "root" }, "apps/app": { name: "app", version: "1.0.0" } },
		packages: {
			app: ["app@workspace:apps/app"],
			"@scope/library": [
				"@scope/library@1.2.3",
				"",
				{ bin: "cli.js", os: "linux", cpu: "x64", peerDependencies: { peer: "1.0.0" }, optionalPeers: ["peer"] },
				"sha512-test",
			],
			"app/dependency": ["dependency@2.0.0", "", {}, "sha512-test"],
			"@scope/library/@other/nested": ["@other/nested@3.0.0", "", {}, "sha512-test"],
		},
	});
	assert.deepEqual(result["node_modules/app"], { resolved: "apps/app", link: true });
	assert.equal(result["apps/app/node_modules/dependency"].version, "2.0.0");
	assert.equal(result["node_modules/@scope/library/node_modules/@other/nested"].version, "3.0.0");
	assert.deepEqual(result["node_modules/@scope/library"], {
		bin: { library: "cli.js" },
		os: ["linux"],
		cpu: ["x64"],
		peerDependencies: { peer: "1.0.0" },
		peerDependenciesMeta: { peer: { optional: true } },
		version: "1.2.3",
		resolved: "https://registry.npmjs.org/@scope/library/-/library-1.2.3.tgz",
		integrity: "sha512-test",
	});
});

test("retains custom registry tarball URLs", () => {
	const result = toNpmLockPackages({
		lockfileVersion: 2,
		workspaces: {},
		packages: { library: ["library@1.0.0", "https://registry.example/library.tgz", {}, "sha512-test"] },
	});
	assert.equal(result["node_modules/library"].resolved, "https://registry.example/library.tgz");
});

test("rejects unsupported lock versions and unpinned non-registry sources", () => {
	assert.throws(() => toNpmLockPackages({ lockfileVersion: 99 }), /Expected a Bun v2/);
	assert.throws(
		() => toNpmLockPackages({ lockfileVersion: 2, workspaces: {}, packages: { library: ["library@git:example"] } }),
		/Unsupported Bun lock entry/,
	);
});

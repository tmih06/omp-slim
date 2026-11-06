import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateAuthJsonToSqliteStore } from "../src/core/auth-json-migration.ts";
import { SqliteAuthStorage } from "../src/core/sqlite-auth-storage.ts";

const dirs: string[] = [];

function createDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-slim-migrate-"));
	dirs.push(dir);
	return dir;
}

function openStore(dir: string): SqliteAuthStorage {
	return new SqliteAuthStorage(join(dir, "agent.db"));
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("migrateAuthJsonToSqliteStore", () => {
	it("imports a legacy auth.json and archives it", () => {
		const dir = createDir();
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({
				anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1, accountId: "acct-a" },
				openai: { type: "api_key", key: "sk-test" },
			}),
		);
		const store = openStore(dir);

		const result = migrateAuthJsonToSqliteStore(store, { agentDir: dir });

		expect(result.migratedProviders).toEqual(["anthropic", "openai"]);
		expect(result.archivedPath).toBe(join(dir, "auth.json.migrated"));
		// The original is moved aside, not deleted, so a downgrade can restore it.
		expect(() => readFileSync(join(dir, "auth.json"))).toThrow();
		expect(readFileSync(join(dir, "auth.json.migrated"), "utf-8")).toContain("acct-a");
		store.close();
	});

	it("makes each imported provider's credential its active account", async () => {
		const dir = createDir();
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({ anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1, accountId: "acct-a" } }),
		);
		const store = openStore(dir);
		migrateAuthJsonToSqliteStore(store, { agentDir: dir });

		expect(await store.read("anthropic")).toMatchObject({ type: "oauth", access: "a" });
		expect(await store.listAccounts()).toMatchObject([
			{ providerId: "anthropic", accountKey: "acct-a", active: true },
		]);
		store.close();
	});

	it("does nothing without a legacy file", () => {
		const dir = createDir();
		const store = openStore(dir);

		expect(migrateAuthJsonToSqliteStore(store, { agentDir: dir })).toEqual({ migratedProviders: [] });
		expect(store.accountCount()).toBe(0);
		store.close();
	});

	it("does not overwrite a store that already holds credentials", async () => {
		const dir = createDir();
		const store = openStore(dir);
		await store.saveAccount("anthropic", "acct-existing", {
			type: "oauth",
			refresh: "r",
			access: "existing",
			expires: 1,
		});
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({ anthropic: { type: "oauth", refresh: "r2", access: "legacy", expires: 1 } }),
		);

		expect(migrateAuthJsonToSqliteStore(store, { agentDir: dir })).toEqual({ migratedProviders: [] });
		expect(await store.read("anthropic")).toMatchObject({ access: "existing" });
		// The legacy file stays for the user to inspect rather than being silently discarded.
		expect(readFileSync(join(dir, "auth.json"), "utf-8")).toContain("legacy");
		store.close();
	});

	it("skips legacy entries that are not credentials", () => {
		const dir = createDir();
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({
				anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 },
				broken: { type: "unknown" },
				junk: "not-an-object",
			}),
		);
		const store = openStore(dir);

		expect(migrateAuthJsonToSqliteStore(store, { agentDir: dir }).migratedProviders).toEqual(["anthropic"]);
		store.close();
	});

	it("leaves a corrupt legacy file untouched", () => {
		const dir = createDir();
		writeFileSync(join(dir, "auth.json"), "{not json");
		const store = openStore(dir);

		expect(migrateAuthJsonToSqliteStore(store, { agentDir: dir })).toEqual({ migratedProviders: [] });
		expect(readFileSync(join(dir, "auth.json"), "utf-8")).toBe("{not json");
		store.close();
	});

	it("runs only once", async () => {
		const dir = createDir();
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({ anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 } }),
		);
		const store = openStore(dir);

		expect(migrateAuthJsonToSqliteStore(store, { agentDir: dir }).migratedProviders).toEqual(["anthropic"]);
		expect(migrateAuthJsonToSqliteStore(store, { agentDir: dir }).migratedProviders).toEqual([]);
		expect(store.accountCount()).toBe(1);
		store.close();
	});
});

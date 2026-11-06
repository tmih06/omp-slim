import { mkdtempSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveAccountKey, SqliteAuthStorage } from "../src/core/sqlite-auth-storage.ts";

const dirs: string[] = [];
const stores: SqliteAuthStorage[] = [];

function createStore(): { store: SqliteAuthStorage; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "omp-slim-auth-"));
	dirs.push(dir);
	const path = join(dir, "agent.db");
	const store = new SqliteAuthStorage(path);
	stores.push(store);
	return { store, path };
}

function oauth(accountId: string, extra: Record<string, unknown> = {}) {
	return {
		type: "oauth" as const,
		refresh: `refresh-${accountId}`,
		access: `access-${accountId}`,
		expires: Date.now() + 3_600_000,
		accountId,
		...extra,
	};
}

afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("deriveAccountKey", () => {
	it("uses the OAuth account id, then email, then project", () => {
		expect(deriveAccountKey(oauth("acct-1"))).toBe("acct-1");
		expect(deriveAccountKey(oauth("x", { accountId: undefined, email: "user@example.com" }))).toBe(
			"user@example.com",
		);
		expect(deriveAccountKey(oauth("x", { accountId: undefined, projectId: "proj" }))).toBe("proj");
	});

	it("keeps two organizations of one account apart", () => {
		expect(deriveAccountKey(oauth("acct-1", { orgId: "org-a" }))).toBe("acct-1|org:org-a");
		expect(deriveAccountKey(oauth("acct-1", { orgId: "org-b" }))).toBe("acct-1|org:org-b");
	});

	it("returns null for a credential without identity", () => {
		expect(deriveAccountKey(oauth("", { accountId: undefined, email: undefined, projectId: undefined }))).toBeNull();
	});

	it("does not put an API key secret in the account key", () => {
		const key = "sk-ant-super-secret-value-0123456789";
		const derived = deriveAccountKey({ type: "api_key", key });

		expect(derived).not.toBeNull();
		expect(derived).not.toContain(key);
		expect(derived).not.toContain("super-secret");
	});
});

describe("SqliteAuthStorage", () => {
	it("keeps several accounts of one provider side by side", async () => {
		const { store } = createStore();

		await store.saveAccount("anthropic", deriveAccountKey(oauth("acct-a")), oauth("acct-a"));
		await store.saveAccount("anthropic", deriveAccountKey(oauth("acct-b")), oauth("acct-b"));

		const accounts = await store.listAccounts();
		expect(accounts.map((account) => account.accountKey).sort()).toEqual(["acct-a", "acct-b"]);
		expect(accounts.filter((account) => account.active)).toHaveLength(1);
	});

	it("makes the most recently saved account the active one", async () => {
		const { store } = createStore();

		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("anthropic", "acct-b", oauth("acct-b"));

		const credential = await store.read("anthropic");
		expect(credential).toMatchObject({ type: "oauth", access: "access-acct-b" });
	});

	it("replaces a stored account with the same identity instead of adding a row", async () => {
		const { store } = createStore();

		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("anthropic", "acct-a", oauth("acct-a", { access: "rotated" }));

		const accounts = await store.listAccounts();
		expect(accounts).toHaveLength(1);
		expect(await store.read("anthropic")).toMatchObject({ access: "rotated" });
	});

	it("reads a specific account by key without changing the active one", async () => {
		const { store } = createStore();

		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("anthropic", "acct-b", oauth("acct-b"));

		const other = await store.read("anthropic", { accountKey: "acct-a" });
		expect(other).toMatchObject({ access: "access-acct-a" });
		expect(await store.read("anthropic")).toMatchObject({ access: "access-acct-b" });
	});

	it("switches the active account", async () => {
		const { store } = createStore();

		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("anthropic", "acct-b", oauth("acct-b"));

		expect(await store.selectAccount("anthropic", "acct-a")).toBe(true);
		expect(await store.read("anthropic")).toMatchObject({ access: "access-acct-a" });
		expect(await store.selectAccount("anthropic", "missing")).toBe(false);
	});

	it("promotes a remaining account when the active one is deleted", async () => {
		const { store } = createStore();

		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("anthropic", "acct-b", oauth("acct-b"));

		expect(await store.deleteAccount("anthropic", "acct-b")).toBe(true);
		const remaining = await store.read("anthropic");
		expect(remaining).toMatchObject({ access: "access-acct-a" });
		expect(await store.deleteAccount("anthropic", "acct-b")).toBe(false);
	});

	it("keeps providers independent", async () => {
		const { store } = createStore();

		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("openai", "acct-z", oauth("acct-z"));

		expect(await store.read("anthropic")).toMatchObject({ access: "access-acct-a" });
		expect(await store.read("openai")).toMatchObject({ access: "access-acct-z" });
		expect((await store.list()).map((entry) => entry.providerId)).toEqual(["anthropic", "openai"]);
	});

	it("survives reopening the database file", async () => {
		const { store, path } = createStore();

		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("anthropic", "acct-b", oauth("acct-b"));
		store.close();
		stores.splice(stores.indexOf(store), 1);

		const reopened = new SqliteAuthStorage(path);
		stores.push(reopened);
		// Rows come back in OMP's id order; the selection is what must survive.
		expect((await reopened.listAccounts()).filter((account) => account.active)).toMatchObject([
			{ accountKey: "acct-b" },
		]);
		expect(await reopened.read("anthropic")).toMatchObject({ access: "access-acct-b" });
	});

	it("writes the database owner-only", async () => {
		const { path } = createStore();

		if (process.platform === "win32") return;
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("keeps secrets out of the metadata reads", async () => {
		const { store } = createStore();
		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));

		const accounts = await store.listAccounts();
		const listed = await store.list();

		expect(JSON.stringify(accounts)).not.toContain("access-acct-a");
		expect(JSON.stringify(accounts)).not.toContain("refresh-acct-a");
		expect(JSON.stringify(listed)).not.toContain("access-acct-a");
	});

	it("updates the active account through modify", async () => {
		const { store } = createStore();
		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));

		const updated = await store.modify("anthropic", async (current) =>
			current && current.type === "oauth" ? { ...current, access: "refreshed" } : current,
		);

		expect(updated).toMatchObject({ access: "refreshed" });
		expect(await store.read("anthropic")).toMatchObject({ access: "refreshed" });
		expect(await store.listAccounts()).toHaveLength(1);
	});

	it("removes every account of a provider on delete", async () => {
		const { store } = createStore();
		await store.saveAccount("anthropic", "acct-a", oauth("acct-a"));
		await store.saveAccount("anthropic", "acct-b", oauth("acct-b"));

		await store.delete("anthropic");

		expect(await store.listAccounts()).toEqual([]);
		expect(await store.read("anthropic")).toBeUndefined();
	});
});

describe("OMP database compatibility", () => {
	/**
	 * OMP owns ~/.pi/agent/agent.db. Its auth_credentials has no `active` column, and this store must
	 * open that file rather than requiring its own schema — creating the table is a no-op there, so
	 * any column this store assumes would fail at index creation.
	 */
	function createOmpDatabase(dir: string): string {
		const path = join(dir, "agent.db");
		const db = new DatabaseSync(path);
		db.exec(`
			CREATE TABLE auth_credentials (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				provider TEXT NOT NULL,
				credential_type TEXT NOT NULL,
				data TEXT NOT NULL,
				disabled_cause TEXT DEFAULT NULL,
				identity_key TEXT DEFAULT NULL,
				created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
				updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
			);
			CREATE INDEX idx_auth_provider ON auth_credentials(provider);
			CREATE UNIQUE INDEX idx_auth_provider_identity ON auth_credentials(provider, identity_key) WHERE identity_key IS NOT NULL;
			CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
			CREATE TABLE auth_credential_blocks (
				credential_id INTEGER NOT NULL, provider_key TEXT NOT NULL, block_scope TEXT NOT NULL DEFAULT '',
				blocked_until_ms INTEGER NOT NULL, updated_at INTEGER NOT NULL,
				PRIMARY KEY (credential_id, provider_key, block_scope)
			);
		`);
		// Two accounts of one provider, as OMP stores them.
		for (const [account, id] of [
			["tmih.real@gmail.com", 14],
			["second@gmail.com", 18],
		] as const) {
			db.prepare(
				"INSERT INTO auth_credentials (id, provider, credential_type, data, identity_key) VALUES (?, 'google', 'oauth', ?, ?)",
			).run(
				id,
				JSON.stringify({ refresh: "r", access: `a-${id}`, expires: Date.now() + 3_600_000, accountId: id }),
				`email:${account}`,
			);
		}
		db.close();
		return path;
	}

	it("opens a database whose auth_credentials lacks the active column", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-compat-"));
		dirs.push(dir);
		const path = createOmpDatabase(dir);

		// The crash this guards against: an index over a column OMP does not have.
		const store = new SqliteAuthStorage(path);
		stores.push(store);

		const accounts = await store.listAccounts();
		expect(accounts.map((account) => account.accountKey)).toEqual([
			"email:tmih.real@gmail.com",
			"email:second@gmail.com",
		]);
		// OMP's default is the lowest id among enabled rows.
		expect(accounts.filter((account) => account.active)).toMatchObject([{ accountKey: "email:tmih.real@gmail.com" }]);
	});

	it("leaves OMP's credential ids and block references untouched when selecting", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-compat-"));
		dirs.push(dir);
		const path = createOmpDatabase(dir);
		const store = new SqliteAuthStorage(path);
		stores.push(store);

		const inspector = new DatabaseSync(path);
		inspector
			.prepare(
				"INSERT INTO auth_credential_blocks (credential_id, provider_key, blocked_until_ms, updated_at) VALUES (14, 'google', 0, 0)",
			)
			.run();
		inspector.close();

		expect(await store.selectAccount("google", "email:second@gmail.com")).toBe(true);

		// Renumbering rows would have broken this foreign key by convention.
		const check = new DatabaseSync(path);
		const ids = (check.prepare("SELECT id FROM auth_credentials ORDER BY id").all() as Array<{ id: number }>).map(
			(row) => row.id,
		);
		const block = check.prepare("SELECT credential_id FROM auth_credential_blocks").get() as {
			credential_id: number;
		};
		check.close();
		expect(ids).toEqual([14, 18]);
		expect(block.credential_id).toBe(14);

		const accounts = await store.listAccounts();
		expect(accounts.filter((account) => account.active)).toMatchObject([{ accountKey: "email:second@gmail.com" }]);
	});

	it("tombstones instead of deleting, so OMP sees the account as gone", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-compat-"));
		dirs.push(dir);
		const path = createOmpDatabase(dir);
		const store = new SqliteAuthStorage(path);
		stores.push(store);

		expect(await store.deleteAccount("google", "email:second@gmail.com")).toBe(true);

		const check = new DatabaseSync(path);
		const row = check
			.prepare("SELECT disabled_cause FROM auth_credentials WHERE identity_key = ?")
			.get("email:second@gmail.com") as { disabled_cause: string | null };
		check.close();
		expect(row.disabled_cause).not.toBeNull();
		expect(await store.listAccounts()).toHaveLength(1);
	});
});

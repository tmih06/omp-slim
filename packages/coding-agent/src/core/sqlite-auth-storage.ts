/**
 * Multi-account credential storage backed by SQLite.
 *
 * The database is shared with OMP (`~/.pi/agent/agent.db`), so this store speaks OMP's schema rather
 * than defining its own. That matters: OMP's `auth_credentials` already holds one row per account,
 * keyed by `identity_key`, with `disabled_cause` as the tombstone — everything multi-account needs
 * except which account is *selected*. A competing schema in the same file cannot work, because
 * `CREATE TABLE IF NOT EXISTS` is a no-op against an existing table and any column this store invented
 * (`active`) is absent from OMP's, which fails the moment an index mentions it.
 *
 * OMP's schema is used exactly as OMP defines it, with no added tables or columns:
 * - Enabled rows are `disabled_cause IS NULL`; accounts are distinguished by `identity_key`.
 * - Removal is a `disabled_cause` tombstone, never a `DELETE`, so OMP agrees the row is gone.
 * - OMP has no "active account" column. Its durable default is the provider's oldest enabled row
 *   (`ORDER BY id ASC`), with per-session pins layered on top. `selectAccount` therefore reorders:
 *   it sets the chosen row's `created_at` to just before the current oldest, which makes it the
 *   default for both tools without inventing state OMP would not understand.
 *
 * Writes run in SQLite transactions, which serialize across processes: no lock file is needed.
 */

import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	AuthOperationOptions,
	Credential,
	CredentialAccountInfo,
	CredentialAccountKey,
	CredentialInfo,
	CredentialStore,
} from "@earendil-works/pi-ai";
import { resolveConfigValue } from "./resolve-config-value.ts";

type CredentialRow = {
	id: number;
	provider: string;
	credential_type: string;
	data: string;
	identity_key: string | null;
	disabled_cause: string | null;
	created_at: number;
};

/** OMP's tombstone value for a credential the user logged out of. */
const LOGOUT_CAUSE = "logout";

/** Tables OMP itself creates; listed only so a fresh database matches what OMP expects. */
const AUTH_CREDENTIALS_DDL = `
	CREATE TABLE IF NOT EXISTS auth_credentials (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		provider TEXT NOT NULL,
		credential_type TEXT NOT NULL,
		data TEXT NOT NULL,
		disabled_cause TEXT DEFAULT NULL,
		identity_key TEXT DEFAULT NULL,
		created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
		updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
	);
	CREATE INDEX IF NOT EXISTS idx_auth_provider ON auth_credentials(provider);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_provider_identity
		ON auth_credentials(provider, identity_key) WHERE identity_key IS NOT NULL;
	-- OMP's generic key/value store. Only used here to record which account is selected; OMP prunes
	-- it by expiry, so this store writes a far-future expiry to keep its own keys alive.
	CREATE TABLE IF NOT EXISTS cache (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		expires_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
`;

/**
 * Derive the account key for a credential: stable for the account it belongs to, so storing the same
 * account twice replaces its row instead of adding one.
 *
 * OAuth identity comes from the token's own claims, in the order `accountId`, `email`, `projectId`,
 * mirroring OMP's `oauthAccountKey`, with `orgId` appended when present so two organizations of one
 * account stay separate. API keys have no identity claim, so the key is an env hint or a digest of the
 * key itself; hashing keeps a secret out of a column the app reads for display.
 */
export function deriveAccountKey(credential: Credential): CredentialAccountKey {
	if (credential.type === "oauth") {
		const base =
			readString(credential, "accountId") ?? readString(credential, "email") ?? readString(credential, "projectId");
		if (!base) return null;
		const org = readString(credential, "orgId");
		return org ? `${base}|org:${org}` : base;
	}

	const env = credential.env ?? {};
	for (const name of ["ANTHROPIC_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "GOOGLE_CLOUD_PROJECT", "OPENAI_ORG_ID"]) {
		const value = env[name];
		if (typeof value === "string" && value.trim().length > 0) return `env:${value.trim()}`;
	}
	const key = credential.key?.trim();
	if (!key) return null;
	if (key.length <= 8) return `key:${key}`;
	return `key:${hashSecret(key)}`;
}

/** A short, non-reversible tag for a secret, so two keys of one provider stay distinguishable. */
function hashSecret(secret: string): string {
	let first = 0x811c9dc5;
	let second = 0x01000193;
	for (let i = 0; i < secret.length; i++) {
		const code = secret.charCodeAt(i);
		first = Math.imul(first ^ code, 0x01000193) >>> 0;
		second = Math.imul(second + code, 0x85ebca6b) >>> 0;
	}
	return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function readString(source: object, field: string): string | undefined {
	const value = (source as Record<string, unknown>)[field];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Display label for an account, from the credential's own non-secret claims. */
function accountLabel(credential: Credential): string | undefined {
	if (credential.type === "oauth") {
		return (
			readString(credential, "email") ?? readString(credential, "accountId") ?? readString(credential, "projectId")
		);
	}
	const env = credential.env ?? {};
	for (const name of ["ANTHROPIC_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID", "GOOGLE_CLOUD_PROJECT", "OPENAI_ORG_ID"]) {
		const value = env[name];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

function toRowCredential(row: CredentialRow): Credential | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.data);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	const data = parsed as Record<string, unknown>;
	if (row.credential_type === "api_key") {
		return typeof data.key === "string" ? ({ type: "api_key", key: data.key } satisfies Credential) : undefined;
	}
	if (row.credential_type === "oauth") return { type: "oauth", ...data } as Credential;
	return undefined;
}

/** Serialize in the shape OMP reads: `{ key }` plus any provider env for API keys, claims for OAuth. */
function serializeCredential(credential: Credential): string {
	if (credential.type === "api_key") {
		const env = credential.env;
		return JSON.stringify({ key: credential.key, ...(env ? { env } : {}) });
	}
	const { type: _type, ...rest } = credential;
	return JSON.stringify(rest);
}

function toAccountInfo(row: CredentialRow, _id: number, active: boolean): CredentialAccountInfo {
	const credential = toRowCredential(row);
	return {
		providerId: row.provider,
		type: row.credential_type === "oauth" ? "oauth" : "api_key",
		accountKey: row.identity_key,
		...(credential ? { label: accountLabel(credential) } : {}),
		active,
		createdAt: row.created_at,
	};
}

export type SqliteAuthStorageOptions = {
	/** Time SQLite waits on a competing writer. Defaults to 5s, matching the chord adapter. */
	busyTimeoutMs?: number;
};

/**
 * Credential storage with several accounts per provider, sharing OMP's database.
 *
 * `read(providerId)` returns the selected account, so every caller that predates multi-account keeps
 * working; `listAccounts`, `saveAccount`, `selectAccount`, and `deleteAccount` expose the rest.
 */
export class SqliteAuthStorage implements CredentialStore {
	private readonly db: DatabaseSync;
	private closed = false;

	constructor(path: string, options: SqliteAuthStorageOptions = {}) {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.db = new DatabaseSync(path);
		this.db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5_000))}`);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA foreign_keys = ON");
		this.db.exec(AUTH_CREDENTIALS_DDL);
		this.upgradeAuthCredentials();
		// The file holds tokens; keep it owner-only even if it predates this store.
		chmodOwnerOnly(path);
	}

	/**
	 * Add the columns OMP adds in its own migrations, so an older database (or one OMP wrote before
	 * this version) works here too. `ALTER TABLE ... ADD COLUMN` is skipped when the column exists.
	 */
	private upgradeAuthCredentials(): void {
		const columns = new Set(
			(this.db.prepare("PRAGMA table_info(auth_credentials)").all() as Array<{ name: string }>).map((c) => c.name),
		);
		if (!columns.has("identity_key")) {
			this.db.exec("ALTER TABLE auth_credentials ADD COLUMN identity_key TEXT DEFAULT NULL");
		}
		if (!columns.has("disabled_cause")) {
			this.db.exec("ALTER TABLE auth_credentials ADD COLUMN disabled_cause TEXT DEFAULT NULL");
		}
		// The unique index needs identity_key, so create it after the column is guaranteed.
		this.db.exec(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_provider_identity
				ON auth_credentials(provider, identity_key) WHERE identity_key IS NOT NULL;
		`);
	}

	/** Enabled rows for one provider, oldest first. */
	private rowsFor(providerId: string): CredentialRow[] {
		return this.db
			.prepare(
				`SELECT id, provider, credential_type, data, identity_key, disabled_cause, created_at
				 FROM auth_credentials WHERE provider = ? AND disabled_cause IS NULL ORDER BY id ASC`,
			)
			.all(providerId) as CredentialRow[];
	}

	/** Cache key naming the account this store selected for a provider. */
	private static selectionKey(providerId: string): string {
		return `omp-slim:auth-active:${providerId}`;
	}

	/**
	 * Record which account a provider should use.
	 *
	 * OMP has no column for this, and its credential ids cannot be renumbered to express it: OMP keys
	 * `auth_credential_blocks` and refresh leases by `credential_id`, so moving a row would break
	 * those references, and ids are globally unique across providers so one cannot be slid below
	 * another. The selection therefore lives in OMP's generic `cache` table under this store's own
	 * key. OMP only prunes that table by expiry, so a namespaced key is inert to it; if the row is
	 * ever pruned, `read` falls back to OMP's default (the oldest enabled account).
	 */
	private setSelected(providerId: string, credentialId: number): void {
		this.db
			.prepare(
				`INSERT INTO cache (key, value, expires_at) VALUES (?, ?, ?)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
			)
			.run(
				SqliteAuthStorage.selectionKey(providerId),
				String(credentialId),
				Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
			);
	}

	/** The credential id last selected for a provider, when that row is still enabled. */
	private selectedId(providerId: string): number | undefined {
		const row = this.db
			.prepare("SELECT value FROM cache WHERE key = ?")
			.get(SqliteAuthStorage.selectionKey(providerId)) as { value: string } | undefined;
		if (!row) return undefined;
		const id = Number(row.value);
		if (!Number.isInteger(id)) return undefined;
		const credential = this.db
			.prepare("SELECT id FROM auth_credentials WHERE id = ? AND disabled_cause IS NULL")
			.get(id) as { id: number } | undefined;
		return credential?.id;
	}

	private transaction<T>(fn: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const result = fn();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	async read(
		providerId: string,
		options?: AuthOperationOptions & { accountKey?: CredentialAccountKey },
	): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const credential = this.readSync(providerId, options?.accountKey);
		options?.signal?.throwIfAborted();
		if (!credential || credential.type !== "api_key" || credential.key === undefined) return credential;
		return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
	}

	/** {@link read} without the promise, for construction-time work such as migration. */
	readSync(providerId: string, accountKey?: CredentialAccountKey): Credential | undefined {
		const rows = this.rowsFor(providerId);
		// Without a recorded selection, `rows[0]` (lowest id) is OMP's default account.
		const selected = accountKey === undefined ? this.selectedId(providerId) : undefined;
		const row =
			accountKey === undefined
				? (rows.find((candidate) => candidate.id === selected) ?? rows[0])
				: rows.find((candidate) => candidate.identity_key === accountKey);
		return row ? toRowCredential(row) : undefined;
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		const rows = this.db
			.prepare(
				`SELECT DISTINCT provider, credential_type FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY provider ASC`,
			)
			.all() as Array<{ provider: string; credential_type: string }>;
		return rows.map((row) => ({
			providerId: row.provider,
			type: row.credential_type === "oauth" ? "oauth" : "api_key",
		}));
	}

	async listAccounts(options?: AuthOperationOptions): Promise<readonly CredentialAccountInfo[]> {
		options?.signal?.throwIfAborted();
		return this.listAccountsSync();
	}

	/** {@link listAccounts} without the promise, for construction-time work such as migration. */
	listAccountsSync(): readonly CredentialAccountInfo[] {
		const rows = this.db
			.prepare(
				`SELECT id, provider, credential_type, data, identity_key, disabled_cause, created_at
				 FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY provider ASC, id ASC`,
			)
			.all() as CredentialRow[];
		// Mirrors read(): the recorded selection, or the provider's oldest enabled row.
		const defaultIds = new Map<string, number | undefined>();
		for (const row of rows) {
			if (!defaultIds.has(row.provider)) defaultIds.set(row.provider, this.selectedId(row.provider));
		}
		const activeIds = new Set<number>();
		for (const [providerId, selected] of defaultIds) {
			const first = rows.find((row) => row.provider === providerId)?.id;
			const effective = selected ?? first;
			if (effective !== undefined) activeIds.add(effective);
		}
		return rows.map((row) => toAccountInfo(row, row.id, activeIds.has(row.id)));
	}

	/** Number of stored accounts across all providers. */
	accountCount(): number {
		const row = this.db
			.prepare("SELECT COUNT(*) AS count FROM auth_credentials WHERE disabled_cause IS NULL")
			.get() as { count: number };
		return row.count;
	}

	/** Whether any enabled credential is stored for `providerId`. */
	hasProvider(providerId: string): boolean {
		const row = this.db
			.prepare("SELECT 1 AS present FROM auth_credentials WHERE provider = ? AND disabled_cause IS NULL LIMIT 1")
			.get(providerId);
		return row !== undefined;
	}

	async saveAccount(
		providerId: string,
		accountKey: CredentialAccountKey,
		credential: Credential,
		options?: AuthOperationOptions,
	): Promise<readonly CredentialAccountInfo[]> {
		options?.signal?.throwIfAborted();
		const accounts = this.saveAccountSync(providerId, accountKey, credential);
		options?.signal?.throwIfAborted();
		return accounts;
	}

	/** {@link saveAccount} without the promise, for construction-time work such as migration. */
	saveAccountSync(
		providerId: string,
		accountKey: CredentialAccountKey,
		credential: Credential,
	): readonly CredentialAccountInfo[] {
		const data = serializeCredential(credential);
		this.transaction(() => {
			// Match on the account identity, and revive a row OMP or this store tombstoned earlier.
			const existing =
				accountKey === null
					? (this.db
							.prepare(
								"SELECT id FROM auth_credentials WHERE provider = ? AND identity_key IS NULL ORDER BY id ASC LIMIT 1",
							)
							.get(providerId) as { id: number } | undefined)
					: (this.db
							.prepare("SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ?")
							.get(providerId, accountKey) as { id: number } | undefined);

			let rowId: number;
			if (existing) {
				this.db
					.prepare(
						`UPDATE auth_credentials
						 SET credential_type = ?, data = ?, disabled_cause = NULL,
						     updated_at = CAST(strftime('%s','now') AS INTEGER)
						 WHERE id = ?`,
					)
					.run(credential.type, data, existing.id);
				rowId = existing.id;
			} else {
				const inserted = this.db
					.prepare(
						`INSERT INTO auth_credentials (provider, credential_type, data, identity_key)
						 VALUES (?, ?, ?, ?) RETURNING id`,
					)
					.get(providerId, credential.type, data, accountKey) as { id: number };
				rowId = inserted.id;
			}
			// Saving an account makes it the provider's default, matching "log in and use it".
			this.setSelected(providerId, rowId);
		});
		return this.listAccountsSync().filter((account) => account.providerId === providerId);
	}

	async selectAccount(
		providerId: string,
		accountKey: CredentialAccountKey,
		options?: AuthOperationOptions,
	): Promise<boolean> {
		options?.signal?.throwIfAborted();
		const row = this.db
			.prepare("SELECT id FROM auth_credentials WHERE provider = ? AND identity_key IS ? AND disabled_cause IS NULL")
			.get(providerId, accountKey) as { id: number } | undefined;
		options?.signal?.throwIfAborted();
		if (!row) return false;
		this.transaction(() => this.setSelected(providerId, row.id));
		return true;
	}

	async deleteAccount(
		providerId: string,
		accountKey: CredentialAccountKey,
		options?: AuthOperationOptions,
	): Promise<boolean> {
		options?.signal?.throwIfAborted();
		return this.transaction(() => {
			// Tombstone rather than DELETE, so OMP and this store agree the account is gone while the
			// row stays available to OMP's disabled-credential listing.
			const result = this.db
				.prepare(
					`UPDATE auth_credentials
					 SET disabled_cause = ?, updated_at = CAST(strftime('%s','now') AS INTEGER)
					 WHERE provider = ? AND identity_key IS ? AND disabled_cause IS NULL`,
				)
				.run(LOGOUT_CAUSE, providerId, accountKey);
			if (result.changes === 0) return false;
			this.clearSelection(providerId);
			return true;
		});
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		// `fn` is async, so one SQLite transaction cannot span the await. Each write is atomic on its
		// own, and concurrent refreshes of one provider are serialized by their callers.
		const current = await this.read(providerId, options);
		const next = await fn(current);
		options?.signal?.throwIfAborted();
		if (next === undefined) return current;
		await this.saveAccount(providerId, deriveAccountKey(next), next, options);
		return next;
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.transaction(() => {
			this.db
				.prepare(
					`UPDATE auth_credentials
					 SET disabled_cause = ?, updated_at = CAST(strftime('%s','now') AS INTEGER)
					 WHERE provider = ? AND disabled_cause IS NULL`,
				)
				.run(LOGOUT_CAUSE, providerId);
			this.clearSelection(providerId);
		});
	}

	/** Drop a provider's recorded selection; `read` then falls back to OMP's default. */
	private clearSelection(providerId: string): void {
		this.db.prepare("DELETE FROM cache WHERE key = ?").run(SqliteAuthStorage.selectionKey(providerId));
	}

	/** Close the database. Idempotent. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.db.close();
	}
}

function chmodOwnerOnly(path: string): void {
	try {
		chmodSync(path, 0o600);
	} catch {
		// Windows and read-only mounts reject POSIX modes; the directory mode still applies.
	}
}

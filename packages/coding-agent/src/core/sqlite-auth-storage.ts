/**
 * Multi-account credential storage backed by SQLite.
 *
 * One provider can hold several credentials at once, which a single JSON entry per provider cannot
 * express: the same OAuth account in two organizations, two subscriptions, or a key plus a
 * subscription. Each credential is a row; `identity_key` names the account inside the provider, and
 * `active` marks the row `read(providerId)` resolves to.
 *
 * The schema follows OMP's `SqliteAuthCredentialStore` (`@oh-my-pi/pi-ai`), trimmed to credential
 * storage: `auth_credentials` with a per-provider identity key and an identity index. What is
 * deliberately not copied: OMP keys identity through `@oh-my-pi/pi-catalog` provider policy and
 * assigns a surrogated integer id that its whole auth stack passes around. This store derives the
 * identity key here and keeps the integer id private, so the public contract stays
 * `CredentialStore`'s `providerId` + `CredentialAccountKey`.
 *
 * Writes run inside SQLite transactions, which also serialize cross-process: the store needs no
 * separate lock file, unlike the JSON backend.
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
	active: number;
	created_at: number;
};

const JSON_WRITE_COLUMNS = `provider, credential_type, data, identity_key, active, created_at`;

/**
 * Derive the account key for a credential: stable for the account it belongs to, so storing the
 * same account twice replaces its row instead of adding one.
 *
 * OAuth identity comes from the token's own claims, in the order `accountId`, `email`, `projectId`.
 * That mirrors OMP's `oauthAccountKey`, except that OMP layers org scoping on top from its catalog's
 * provider policy; here an `orgId` on the credential is appended when present, which is enough to
 * keep two organizations of one account side by side.
 *
 * API keys have no identity claim, so the key is a hint from the configured env (account id, org,
 * project) or, failing that, a digest of the key itself. Hashing keeps a secret out of a column the
 * app reads for display.
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

function serializeCredential(credential: Credential): string {
	if (credential.type === "api_key") {
		const env = credential.env;
		return JSON.stringify({ key: credential.key, ...(env ? { env } : {}) });
	}
	const { type: _type, ...rest } = credential;
	return JSON.stringify(rest);
}

function toAccountInfo(row: CredentialRow): CredentialAccountInfo {
	const credential = toRowCredential(row);
	return {
		providerId: row.provider,
		type: row.credential_type === "oauth" ? "oauth" : "api_key",
		accountKey: row.identity_key,
		...(credential ? { label: accountLabel(credential) } : {}),
		active: row.active === 1,
		createdAt: row.created_at,
	};
}

export type SqliteAuthStorageOptions = {
	/** Time SQLite waits on a competing writer. Defaults to 5s, matching the chord adapter. */
	busyTimeoutMs?: number;
};

/**
 * Credential storage with several accounts per provider, backed by one SQLite file.
 *
 * `read(providerId)` returns the active account, so every caller that predates multi-account keeps
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
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS auth_credentials (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				provider TEXT NOT NULL,
				credential_type TEXT NOT NULL,
				data TEXT NOT NULL,
				identity_key TEXT DEFAULT NULL,
				active INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
			);
			CREATE INDEX IF NOT EXISTS idx_auth_provider ON auth_credentials(provider);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_provider_identity
				ON auth_credentials(provider, identity_key) WHERE identity_key IS NOT NULL;
			CREATE INDEX IF NOT EXISTS idx_auth_provider_active ON auth_credentials(provider, active);
		`);
		// The file holds tokens; keep it owner-only even if it predates this store.
		chmodOwnerOnly(path);
	}

	/** Rows for one provider, active first, then oldest first. */
	private rowsFor(providerId: string): CredentialRow[] {
		return this.db
			.prepare(
				`SELECT id, provider, credential_type, data, identity_key, active, created_at
				 FROM auth_credentials WHERE provider = ? ORDER BY active DESC, id ASC`,
			)
			.all(providerId) as CredentialRow[];
	}

	/** Mark one row active and every other row of the provider inactive. */
	private activate(providerId: string, id: number): void {
		this.db
			.prepare("UPDATE auth_credentials SET active = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE provider = ?")
			.run(id, providerId);
	}

	/** Ensure the provider has an active row, promoting the oldest when none is. */
	private ensureActive(providerId: string): void {
		const rows = this.rowsFor(providerId);
		if (rows.length === 0 || rows.some((row) => row.active === 1)) return;
		this.activate(providerId, rows[0].id);
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
		const rows = this.rowsFor(providerId);
		const row =
			options?.accountKey === undefined
				? (rows.find((candidate) => candidate.active === 1) ?? rows[0])
				: rows.find((candidate) => candidate.identity_key === options.accountKey);
		options?.signal?.throwIfAborted();
		const credential = row ? toRowCredential(row) : undefined;
		if (!credential || credential.type !== "api_key" || credential.key === undefined) return credential;
		return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		const rows = this.db
			.prepare("SELECT DISTINCT provider, credential_type FROM auth_credentials ORDER BY provider ASC")
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
				`SELECT id, provider, credential_type, data, identity_key, active, created_at
				 FROM auth_credentials ORDER BY provider ASC, active DESC, id ASC`,
			)
			.all() as CredentialRow[];
		return rows.map(toAccountInfo);
	}

	/** Number of stored accounts across all providers. */
	accountCount(): number {
		const row = this.db.prepare("SELECT COUNT(*) AS count FROM auth_credentials").get() as { count: number };
		return row.count;
	}

	/** Whether any credential is stored for `providerId`. */
	hasProvider(providerId: string): boolean {
		const row = this.db
			.prepare("SELECT 1 AS present FROM auth_credentials WHERE provider = ? LIMIT 1")
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
			const existing =
				accountKey === null
					? (this.db
							.prepare("SELECT id FROM auth_credentials WHERE provider = ? AND identity_key IS NULL")
							.get(providerId) as { id: number } | undefined)
					: (this.db
							.prepare("SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ?")
							.get(providerId, accountKey) as { id: number } | undefined);
			let rowId: number;
			if (existing) {
				this.db
					.prepare(
						"UPDATE auth_credentials SET credential_type = ?, data = ?, updated_at = unixepoch() * 1000 WHERE id = ?",
					)
					.run(credential.type, data, existing.id);
				rowId = existing.id;
			} else {
				const inserted = this.db
					.prepare(
						`INSERT INTO auth_credentials (${JSON_WRITE_COLUMNS}) VALUES (?, ?, ?, ?, 0, unixepoch() * 1000) RETURNING id`,
					)
					.get(providerId, credential.type, data, accountKey) as { id: number };
				rowId = inserted.id;
			}
			this.activate(providerId, rowId);
		});
		return this.rowsFor(providerId).map(toAccountInfo);
	}

	async selectAccount(
		providerId: string,
		accountKey: CredentialAccountKey,
		options?: AuthOperationOptions,
	): Promise<boolean> {
		options?.signal?.throwIfAborted();
		const row = this.db
			.prepare("SELECT id FROM auth_credentials WHERE provider = ? AND identity_key IS ?")
			.get(providerId, accountKey) as { id: number } | undefined;
		options?.signal?.throwIfAborted();
		if (!row) return false;
		this.transaction(() => this.activate(providerId, row.id));
		return true;
	}

	async deleteAccount(
		providerId: string,
		accountKey: CredentialAccountKey,
		options?: AuthOperationOptions,
	): Promise<boolean> {
		options?.signal?.throwIfAborted();
		const removed = this.transaction(() => {
			const result = this.db
				.prepare("DELETE FROM auth_credentials WHERE provider = ? AND identity_key IS ?")
				.run(providerId, accountKey);
			this.ensureActive(providerId);
			return result.changes > 0;
		});
		return removed;
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		// `fn` is async, so the read-modify-write cannot hold one SQLite transaction across the await.
		// WAL plus BEGIN IMMEDIATE in saveAccount keeps each individual write atomic; concurrent
		// refreshes of one account are serialized by callers that share a provider id.
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
			this.db.prepare("DELETE FROM auth_credentials WHERE provider = ?").run(providerId);
		});
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

/**
 * One-time move from the single-credential `auth.json` to the multi-account SQLite store.
 *
 * `auth.json` holds one credential per provider, keyed by provider id. The SQLite store
 * (`sqlite-auth-storage.ts`) holds any number per provider, keyed by account. Importing the file is
 * therefore lossless: each entry becomes that provider's first, active account.
 *
 * The file is renamed to `auth.json.migrated` rather than deleted, so a downgrade can restore it and
 * a failed import leaves the original in place. Migration runs only when the database has no rows, so
 * a store emptied by an explicit logout is not silently repopulated from a stale file.
 *
 * This is synchronous because it runs while the credential store is constructed, which every caller
 * treats as synchronous. It touches a handful of rows, so the blocking read is bounded.
 */

import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Credential } from "@earendil-works/pi-ai";
import { getAgentDir } from "../config.ts";
import { stripBom } from "../utils/text.ts";
import { deriveAccountKey, type SqliteAuthStorage } from "./sqlite-auth-storage.ts";

export type AuthMigrationResult = {
	/** Providers imported from the legacy file, in file order. */
	migratedProviders: string[];
	/** Path the legacy file was renamed to, when a migration ran. */
	archivedPath?: string;
};

type LegacyAuthData = Record<string, unknown>;

function isCredential(value: unknown): value is Credential {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const type = (value as { type?: unknown }).type;
	return type === "api_key" || type === "oauth";
}

/**
 * Import `auth.json` into the SQLite store when the store is empty.
 *
 * Returns an empty result when there is nothing to do: no legacy file, or the store already holds
 * credentials.
 */
export function migrateAuthJsonToSqliteStore(
	store: SqliteAuthStorage,
	options: { agentDir?: string } = {},
): AuthMigrationResult {
	const agentDir = options.agentDir ?? getAgentDir();
	const authPath = join(agentDir, "auth.json");
	if (!existsSync(authPath)) return { migratedProviders: [] };

	// A store that already holds credentials keeps them; the legacy file is left untouched so the
	// user can inspect it instead of us guessing which side is authoritative.
	if (store.accountCount() > 0) return { migratedProviders: [] };

	let parsed: LegacyAuthData;
	try {
		parsed = JSON.parse(stripBom(readFileSync(authPath, "utf-8"))) as LegacyAuthData;
	} catch {
		return { migratedProviders: [] };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { migratedProviders: [] };

	const migratedProviders: string[] = [];
	for (const [providerId, value] of Object.entries(parsed)) {
		if (!isCredential(value)) continue;
		// saveAccount makes each imported entry the provider's active account, matching the file,
		// which could only describe one credential per provider.
		store.saveAccountSync(providerId, deriveAccountKey(value), value);
		migratedProviders.push(providerId);
	}

	if (migratedProviders.length === 0) return { migratedProviders: [] };

	const archivedPath = `${authPath}.migrated`;
	try {
		renameSync(authPath, archivedPath);
	} catch {
		// The import already succeeded; a rename failure (read-only directory, Windows sharing
		// violation) must not roll it back. The next start sees a non-empty store and skips.
		return { migratedProviders };
	}
	return { migratedProviders, archivedPath };
}

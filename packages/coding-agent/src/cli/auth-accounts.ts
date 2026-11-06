/**
 * `pi auth accounts` and `pi auth use`, the CLI surface for a provider that holds several accounts.
 *
 * These read and write through `ModelRuntime`, so they see the same store the agent uses and honor
 * providers registered by extensions. They report `null` rather than throwing when the store has no
 * multi-account support, which the commands turn into a clear message.
 */

import type { CredentialAccountInfo } from "@earendil-works/pi-ai";
import { replaceControlCharacters } from "@earendil-works/pi-tui";
import { APP_NAME } from "../config.ts";
import type { ModelRuntime } from "../core/model-runtime.ts";
import { findMatchingProviders } from "../core/provider-matching.ts";
import type { AuthOutput } from "./auth-terminal.ts";

export const AUTH_ACCOUNTS_USAGE = `${APP_NAME} auth accounts [--provider <provider>] [--json]`;
export const AUTH_USE_USAGE = `${APP_NAME} auth use <provider> <account>`;

export interface AuthAccountsOptions {
	modelRuntime: ModelRuntime;
	terminal: AuthOutput;
	signal: AbortSignal;
}

/** Columns of one `accounts` row. The active account is marked with `*`. */
function formatAccountRow(account: CredentialAccountInfo): string {
	const marker = account.active ? "*" : " ";
	const label = account.label ? ` (${replaceControlCharacters(account.label)})` : "";
	const key = account.accountKey === null ? "<no identity>" : replaceControlCharacters(account.accountKey);
	return `${marker} ${account.providerId}  ${key}${label}  [${account.type}]`;
}

async function resolveProviderId(modelRuntime: ModelRuntime, providerRef: string): Promise<string | undefined> {
	const provider = findMatchingProviders(modelRuntime.getProviders(), providerRef)[0];
	if (provider) return provider.id;
	// Providers registered by extensions are not loaded here, so fall back to a stored id.
	const stored = await modelRuntime.listCredentials();
	return stored.some((entry) => entry.providerId === providerRef) ? providerRef : undefined;
}

/**
 * Run `pi auth accounts`: list stored accounts, marking the active one per provider.
 *
 * Returns 1 when `--provider` names an unknown provider, 0 otherwise.
 */
export async function runAuthAccounts(args: string[], options: AuthAccountsOptions): Promise<number> {
	const { modelRuntime, terminal, signal } = options;
	let providerRef: string | undefined;
	let json = false;

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--provider") {
			const value = args[++index];
			if (!value) {
				terminal.error(`Usage: ${AUTH_ACCOUNTS_USAGE}`);
				return 1;
			}
			providerRef = value;
			continue;
		}
		terminal.error(`Usage: ${AUTH_ACCOUNTS_USAGE}`);
		return 1;
	}

	const accounts = await modelRuntime.listCredentialAccounts({ signal });
	if (accounts.length === 0) {
		const stored = await modelRuntime.listCredentials({ signal });
		terminal.write(
			stored.length === 0
				? "No stored accounts."
				: "This credential store does not support multiple accounts; use `auth check` for stored providers.",
		);
		return 0;
	}

	let filtered = accounts;
	if (providerRef !== undefined) {
		const providerId = await resolveProviderId(modelRuntime, providerRef);
		if (!providerId) {
			terminal.error(`Unknown provider "${replaceControlCharacters(providerRef)}".`);
			return 1;
		}
		filtered = accounts.filter((account) => account.providerId === providerId);
		if (filtered.length === 0) {
			terminal.write(`No stored accounts for ${replaceControlCharacters(providerRef)}.`);
			return 0;
		}
	}

	if (json) {
		console.log(JSON.stringify(filtered, null, 2));
		return 0;
	}
	for (const account of filtered) terminal.write(formatAccountRow(account));
	return 0;
}

/**
 * Run `pi auth use <provider> <account>`: make a stored account the active one.
 *
 * Returns 1 when the provider or account is unknown.
 */
export async function runAuthUse(args: string[], options: AuthAccountsOptions): Promise<number> {
	const { modelRuntime, terminal, signal } = options;
	const [providerRef, accountKey, ...rest] = args;
	if (providerRef === undefined || accountKey === undefined || rest.length > 0) {
		terminal.error(`Usage: ${AUTH_USE_USAGE}`);
		return 1;
	}

	const providerId = await resolveProviderId(modelRuntime, providerRef);
	if (!providerId) {
		terminal.error(`Unknown provider "${replaceControlCharacters(providerRef)}".`);
		return 1;
	}

	const selected = await modelRuntime.selectCredentialAccount(providerId, accountKey, { signal });
	if (!selected) {
		const accounts = await modelRuntime.listCredentialAccounts({ signal });
		const available = accounts
			.filter((account) => account.providerId === providerId)
			.map((account) => account.accountKey ?? "<no identity>");
		terminal.error(`No stored account "${replaceControlCharacters(accountKey)}" for ${providerId}.`);
		if (available.length > 0) terminal.error(`Stored accounts: ${available.join(", ")}`);
		return 1;
	}
	terminal.write(`Now using account "${replaceControlCharacters(accountKey)}" for ${providerId}.`);
	return 0;
}

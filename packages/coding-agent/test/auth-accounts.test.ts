import { type Credential, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { runAuthAccounts, runAuthUse } from "../src/cli/auth-accounts.ts";
import { APP_NAME } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const oauthCredential = {
	type: "oauth" as const,
	access: "access",
	refresh: "refresh",
	expires: Date.now() + 3_600_000,
	accountId: "acct-a",
};

/**
 * A runtime whose credential store reports the given accounts. The in-memory store is
 * single-account, so the multi-account capability is layered on exactly as the SQLite store
 * supplies it.
 */
async function setup(accounts: Array<{ providerId: string; accountKey: string; active: boolean }>) {
	const credentials = AuthStorage.inMemory({ radius: oauthCredential } satisfies Record<string, Credential>);
	const modelRuntime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		modelsStore: new InMemoryModelsStore(),
		allowModelNetwork: false,
	});
	let current = accounts;
	Object.assign(modelRuntime, {
		listCredentialAccounts: async () => current.map((account) => ({ ...account, type: "oauth" as const })),
		selectCredentialAccount: async (providerId: string, accountKey: string) => {
			const found = current.some((a) => a.providerId === providerId && a.accountKey === accountKey);
			if (found) current = current.map((a) => ({ ...a, active: a.accountKey === accountKey }));
			return found;
		},
	});
	const lines: string[] = [];
	const errors: string[] = [];
	const options = {
		modelRuntime,
		terminal: { write: (line: string) => lines.push(line), error: (line: string) => errors.push(line) },
		signal: new AbortController().signal,
	};
	return { lines, errors, options, getAccounts: () => current };
}

describe(`${APP_NAME} auth accounts`, () => {
	test("marks the active account per provider", async () => {
		const { lines, options } = await setup([
			{ providerId: "radius", accountKey: "acct-b", active: true },
			{ providerId: "radius", accountKey: "acct-a", active: false },
		]);

		expect(await runAuthAccounts([], options)).toBe(0);
		expect(lines).toEqual(["* radius  acct-b  [oauth]", "  radius  acct-a  [oauth]"]);
	});

	test("filters by provider", async () => {
		const { lines, options } = await setup([
			{ providerId: "radius", accountKey: "acct-a", active: true },
			{ providerId: "openai", accountKey: "acct-z", active: true },
		]);

		expect(await runAuthAccounts(["--provider", "radius"], options)).toBe(0);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("radius");
	});

	test("prints JSON", async () => {
		const { options } = await setup([{ providerId: "radius", accountKey: "acct-a", active: true }]);
		const printed: string[] = [];
		const log = console.log;
		console.log = (line: string) => printed.push(line);
		try {
			expect(await runAuthAccounts(["--json"], options)).toBe(0);
		} finally {
			console.log = log;
		}
		expect(JSON.parse(printed.join("\n"))).toMatchObject([
			{ providerId: "radius", accountKey: "acct-a", active: true },
		]);
	});

	test("says so when the store has no multi-account support", async () => {
		const { lines, options } = await setup([]);

		expect(await runAuthAccounts([], options)).toBe(0);
		expect(lines).toEqual([
			"This credential store does not support multiple accounts; use `auth check` for stored providers.",
		]);
	});

	test("rejects an unknown provider", async () => {
		const { errors, options } = await setup([{ providerId: "radius", accountKey: "acct-a", active: true }]);

		expect(await runAuthAccounts(["--provider", "nope"], options)).toBe(1);
		expect(errors).toEqual(['Unknown provider "nope".']);
	});
});

describe(`${APP_NAME} auth use`, () => {
	test("switches the active account", async () => {
		const { lines, options, getAccounts } = await setup([
			{ providerId: "radius", accountKey: "acct-a", active: true },
			{ providerId: "radius", accountKey: "acct-b", active: false },
		]);

		expect(await runAuthUse(["radius", "acct-b"], options)).toBe(0);
		expect(lines).toEqual(['Now using account "acct-b" for radius.']);
		expect(getAccounts().find((account) => account.active)?.accountKey).toBe("acct-b");
	});

	test("requires a provider and an account", async () => {
		const { errors, options } = await setup([]);

		expect(await runAuthUse(["radius"], options)).toBe(1);
		expect(errors).toEqual([`Usage: ${APP_NAME} auth use <provider> <account>`]);
	});

	test("rejects an unknown account and lists the stored ones", async () => {
		const { errors, options } = await setup([{ providerId: "radius", accountKey: "acct-a", active: true }]);

		expect(await runAuthUse(["radius", "nope"], options)).toBe(1);
		expect(errors).toEqual(['No stored account "nope" for radius.', "Stored accounts: acct-a"]);
	});
});

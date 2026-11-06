import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentSessionEvent, AgentSession } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import { createHarness } from "./harness.ts";

/**
 * Rotation on quota exhaustion. The in-memory credential store is single-account, so the
 * multi-account capability is layered on the runtime exactly as the SQLite store supplies it;
 * `select` records the switch so the test can assert what requests would use next.
 */

type Account = { providerId: string; accountKey: string; active: boolean };

async function harnessWithAccounts(accounts: Account[]) {
	const harness = await createHarness();
	const runtime = harness.session.modelRuntime;
	let current = accounts;

	runtime.listCredentialAccounts = async () => current.map((account) => ({ ...account, type: "oauth" as const }));
	runtime.selectCredentialAccount = async (providerId: string, accountKey: string) => {
		const found = current.some((a) => a.providerId === providerId && a.accountKey === accountKey);
		if (found) current = current.map((a) => ({ ...a, active: a.accountKey === accountKey }));
		return found;
	};

	const rotations = () =>
		harness.session.messages.length >= 0
			? (harness.eventsOfType("account_rotation") as Extract<AgentSessionEvent, { type: "account_rotation" }>[])
			: [];
	return { harness, runtime, rotations, getAccounts: () => current };
}

/** Call the private retry hook the same way an errored response does. */
async function prepareRetry(session: AgentSession, errorMessage: string) {
	const message = {
		role: "assistant" as const,
		content: [],
		api: "anthropic-messages" as const,
		provider: "faux",
		model: "faux",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error" as const,
		errorMessage,
		timestamp: 0,
	};
	const internal = session as unknown as {
		_isRetryableError(message: unknown): boolean;
		_prepareRetry(message: unknown): Promise<boolean>;
	};
	return { retryable: internal._isRetryableError(message), prepared: await internal._prepareRetry(message) };
}

afterEach(() => {
	// Harnesses are cleaned up per test via their own cleanup in the test body.
});

describe("rotation on account quota exhaustion", () => {
	it("treats an exhausted account as retryable so rotation can run", async () => {
		const { harness } = await harnessWithAccounts([]);
		try {
			const { retryable } = await prepareRetry(harness.session, "insufficient_quota");
			expect(retryable).toBe(true);
		} finally {
			harness.cleanup();
		}
	});

	it("switches to a sibling account and reports it", async () => {
		const { harness, rotations, getAccounts } = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
			{ providerId: "faux", accountKey: "acct-b", active: false },
		]);
		try {
			const { prepared } = await prepareRetry(harness.session, "insufficient_quota");

			expect(prepared).toBe(true);
			expect(getAccounts().find((account) => account.active)?.accountKey).toBe("acct-b");
			expect(rotations()).toMatchObject([
				{
					type: "account_rotation",
					providerId: "faux",
					fromAccountKey: "acct-a",
					toAccountKey: "acct-b",
					reason: "quota",
				},
			]);
		} finally {
			harness.cleanup();
		}
	});

	it("moves to the next sibling when the second account is exhausted too", async () => {
		const { harness, rotations, getAccounts } = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
			{ providerId: "faux", accountKey: "acct-b", active: false },
			{ providerId: "faux", accountKey: "acct-c", active: false },
		]);
		try {
			await prepareRetry(harness.session, "insufficient_quota");
			await prepareRetry(harness.session, "insufficient_quota");

			expect(getAccounts().find((account) => account.active)?.accountKey).toBe("acct-c");
			expect(rotations()).toHaveLength(2);
		} finally {
			harness.cleanup();
		}
	});

	it("does not rotate when no sibling account is left", async () => {
		const { harness, rotations, getAccounts } = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
			{ providerId: "faux", accountKey: "acct-b", active: false },
		]);
		try {
			const first = await prepareRetry(harness.session, "insufficient_quota");
			expect(first.prepared).toBe(true);
			expect(getAccounts().find((account) => account.active)?.accountKey).toBe("acct-b");

			// Both accounts are exhausted now: fail immediately instead of burning the retry budget
			// on backoff attempts against an account that cannot recover by waiting.
			const second = await prepareRetry(harness.session, "insufficient_quota");
			expect(second.prepared).toBe(false);
			expect(rotations()).toHaveLength(1);
		} finally {
			harness.cleanup();
		}
	});

	it("leaves a single-account provider on the ordinary failure path", async () => {
		const { harness, rotations } = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
		]);
		try {
			const { prepared } = await prepareRetry(harness.session, "insufficient_quota");

			expect(prepared).toBe(false);
			expect(rotations()).toHaveLength(0);
		} finally {
			harness.cleanup();
		}
	});

	it("does not rotate for transient throttling", async () => {
		const { harness, rotations, getAccounts } = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
			{ providerId: "faux", accountKey: "acct-b", active: false },
		]);
		try {
			await prepareRetry(harness.session, "429 Too Many Requests");

			// The normal backoff retry runs; the active account is unchanged.
			expect(rotations()).toHaveLength(0);
			expect(getAccounts().find((account) => account.active)?.accountKey).toBe("acct-a");
		} finally {
			harness.cleanup();
		}
	});

	it("removes the failed response before retrying, so the retry is not rejected", async () => {
		// Without omitting the failed attempt, the retried request sees a trailing assistant message in
		// agent state and the provider rejects it with "Cannot continue from message role: assistant".
		const { harness, rotations } = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
			{ providerId: "faux", accountKey: "acct-b", active: false },
		]);
		try {
			const session = harness.session as unknown as {
				_omitRecoveryAttempt(message: unknown): void;
				_prepareRetry(message: unknown): Promise<boolean>;
			};
			const omitted: unknown[] = [];
			const original = session._omitRecoveryAttempt.bind(session);
			session._omitRecoveryAttempt = (message: unknown) => {
				omitted.push(message);
				original(message);
			};

			const { prepared } = await prepareRetry(harness.session, "insufficient_quota");

			expect(prepared).toBe(true);
			expect(rotations()).toHaveLength(1);
			expect(omitted).toHaveLength(1);
		} finally {
			harness.cleanup();
		}
	});

	it("does not omit anything when rotation cannot help", async () => {
		const { harness } = await harnessWithAccounts([{ providerId: "faux", accountKey: "acct-a", active: true }]);
		try {
			const session = harness.session as unknown as {
				_omitRecoveryAttempt(message: unknown): void;
				_prepareRetry(message: unknown): Promise<boolean>;
			};
			let omitted = 0;
			session._omitRecoveryAttempt = () => {
				omitted++;
			};

			expect((await prepareRetry(harness.session, "insufficient_quota")).prepared).toBe(false);
			expect(omitted).toBe(0);
		} finally {
			harness.cleanup();
		}
	});

	it("stores no cross-account state beside the session", async () => {
		// Rotation memory lives on the session, so a new session retries the account that was
		// exhausted in a previous one rather than skipping it for the rest of the day.
		const first = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
			{ providerId: "faux", accountKey: "acct-b", active: false },
		]);
		try {
			await prepareRetry(first.harness.session, "insufficient_quota");
			expect(first.getAccounts().find((a) => a.active)?.accountKey).toBe("acct-b");
		} finally {
			first.harness.cleanup();
		}

		const second = await harnessWithAccounts([
			{ providerId: "faux", accountKey: "acct-a", active: true },
			{ providerId: "faux", accountKey: "acct-b", active: false },
		]);
		try {
			const internal = second.harness.session as unknown as { _exhaustedAccountKeys: Set<string> };
			expect(internal._exhaustedAccountKeys.size).toBe(0);
		} finally {
			second.harness.cleanup();
		}
	});
});

describe("ModelRuntime account API", () => {
	it("reports no accounts for a single-account store", async () => {
		const credentials = AuthStorage.inMemory();
		const runtime = await ModelRuntime.create({
			credentials,
			modelsPath: null,
			modelsStore: new InMemoryModelsStore(),
			allowModelNetwork: false,
		});
		expect(await runtime.listCredentialAccounts()).toEqual([]);
		expect(await runtime.selectCredentialAccount("faux", "acct-a")).toBe(false);
		expect(await runtime.deleteCredentialAccount("faux", "acct-a")).toBe(false);
	});
});

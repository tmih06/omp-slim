import { describe, expect, it, vi } from "vitest";
import { parseZaiAuthorizationInput, zaiOAuth } from "../src/auth/oauth/zai.ts";
import type { ProviderAuthInteraction } from "../src/auth/types.ts";
import { zaiProvider } from "../src/providers/zai.ts";

function interaction(pasted: string): ProviderAuthInteraction & { events: string[] } {
	const events: string[] = [];
	return {
		events,
		signal: new AbortController().signal,
		async prompt() {
			return pasted;
		},
		notify(event) {
			events.push(event.type);
		},
	};
}

describe("zai sign-in", () => {
	it("is attached to the zai provider as a subscription login", () => {
		const oauth = zaiProvider().auth.oauth;

		expect(oauth?.isSubscription).toBe(true);
		expect(oauth?.loginLabel).toBe("Sign in with Z.AI");
	});

	it("accepts a pasted redirect URL or a bare code", () => {
		expect(parseZaiAuthorizationInput("zcode://zai-auth/callback?code=abc&state=x")).toBe("abc");
		expect(parseZaiAuthorizationInput("abc")).toBe("abc");
		expect(parseZaiAuthorizationInput("https://host/cb?authCode=zzz")).toBe("zzz");
		// A shell may leave the rest of the query attached to a bare paste.
		expect(parseZaiAuthorizationInput("abc&state=x")).toBe("abc");
		expect(parseZaiAuthorizationInput("   ")).toBeUndefined();
	});

	// OMP's provisioning hook reaches `@oh-my-pi/pi-utils`, whose module body reads `Bun.env`.
	// That is fine in the shipped runtime but throws under Node, so this case needs Bun.
	const itUnderBun = typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? it.skip : it;

	itUnderBun("stores the minted key as a non-expiring credential", async () => {
		const calls: string[] = [];
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			calls.push(url);
			const body = url.includes("oauth/token")
				? { zai: { access_token: "oauth-access" }, user: { email: "a@b.c", id: "u1" } }
				: url.includes("auth/z/login")
					? { code: 200, data: { access_token: "biz" } }
					: url.includes("getCustomerInfo")
						? {
								code: 200,
								data: {
									organizations: [{ organizationId: "o1", isDefault: true, projects: [{ projectId: "p1" }] }],
								},
							}
						: url.includes("/api_keys/copy/")
							? { code: 200, data: { secretKey: "SECRET" } }
							: url.endsWith("/api_keys")
								? { code: 200, data: [{ name: "oh-my-pi", apiKey: "KEY" }] }
								: { code: 200, data: {} };
			return new Response(JSON.stringify(body), { status: 200 });
		});

		try {
			const credential = await zaiOAuth.login(interaction("zcode://cb?code=abc"));

			expect(credential.access).toBe("KEY.SECRET");
			expect(credential.expires).toBe(Number.MAX_SAFE_INTEGER);
			expect(credential.email).toBe("a@b.c");
			expect(credential.accountId).toBe("u1");
			// The provisioning chain must run in order, ending at the key secret.
			expect(calls.some((url) => url.includes("oauth/token"))).toBe(true);
			expect(calls.some((url) => url.includes("auth/z/login"))).toBe(true);
			expect(calls.some((url) => url.includes("/api_keys/copy/"))).toBe(true);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("reports a failed token exchange instead of minting", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 }));
		try {
			await expect(zaiOAuth.login(interaction("abc"))).rejects.toThrow(/no access token/u);
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("does not refresh a durable key", async () => {
		const credential = { type: "oauth" as const, refresh: "K", access: "K", expires: 1 };
		expect(await zaiOAuth.refresh(credential, new AbortController().signal)).toBe(credential);
		expect(await zaiOAuth.toAuth(credential)).toEqual({ apiKey: "K" });
	});
});

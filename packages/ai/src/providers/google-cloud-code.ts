/**
 * Google Antigravity and Gemini CLI providers, served by Cloud Code Assist.
 *
 * Both use the same transport (`google-cloud-code-assist.ts`, adapted from OMP) and the same Google
 * sign-in (`google-cloud-code-auth`), so they differ only in their endpoint and model roster.
 *
 * Antigravity's model list is account-scoped: OMP marks it `dynamic-models-authoritative`, meaning
 * `fetchAvailableModels` is the served roster and bundled rows it omits 404 on every request. A static
 * catalog would therefore promise models the account cannot use, so the shipped list covers only what
 * is known to exist everywhere and `refreshModels` replaces it with the account's own roster.
 */

import type { Model } from "../types.ts";
import { googleCloudCodeAssistApi } from "../api/google-cloud-code-assist.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadGoogleAntigravityOAuth, loadGoogleGeminiCliOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";

/** Antigravity endpoints; the transport fails over to the sandbox host. */
const ANTIGRAVITY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const GEMINI_CLI_ENDPOINT = "https://cloudcode-pa.googleapis.com";

/** Cloud Code serves its own protocol, so the declared `api` is the transport's identity. */
const CLOUD_CODE_API = "google-gemini-cli" as const;

type CloudCodeModel = Model<typeof CLOUD_CODE_API>;

/**
 * Antigravity rows that are always served. Kept deliberately short: anything plan-specific belongs to
 * the account roster fetched by `refreshModels`, not to a shipped default.
 */
const ANTIGRAVITY_BASELINE: CloudCodeModel[] = [
	{
		id: "gemini-3.8-flash-high",
		name: "Gemini 3.8 Flash High",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3.8-flash-medium",
		name: "Gemini 3.8 Flash Medium",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3.8-flash-low",
		name: "Gemini 3.8 Flash Low",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3.8-flash-tiered",
		name: "Gemini 3.8 Flash Tiered",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3.1-pro",
		name: "Gemini 3.1 Pro",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3-flash",
		name: "Gemini 3 Flash",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3.1-flash-lite",
		name: "Gemini 3.1 Flash Lite",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3.1-flash-image",
		name: "Gemini 3.1 Flash Image",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-2.5-flash",
		name: "Gemini 2.5 Flash",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-2.5-flash-thinking",
		name: "Gemini 2.5 Flash Thinking",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "claude-opus-4-6-thinking",
		name: "Claude Opus 4.6 Thinking",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "gpt-oss-120b-medium",
		name: "GPT-OSS 120B Medium",
		api: CLOUD_CODE_API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
];

/** Gemini CLI serves Google's own models through Cloud Code; these ids are the CLI's roster. */
const GEMINI_CLI_BASELINE: CloudCodeModel[] = [
	{
		id: "gemini-3.1-pro-preview",
		name: "Gemini 3.1 Pro (Preview)",
		api: CLOUD_CODE_API,
		provider: "google-gemini-cli",
		baseUrl: GEMINI_CLI_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 64_000,
	},
];

/**
 * Read the account's served roster from the transport's own discovery call.
 *
 * Cloud Code answers `fetchAvailableModels` with the model ids this account may actually use. Failures
 * are non-fatal: the shipped baseline stays in place.
 */
async function discoverAntigravityModels(apiKey: string, signal: AbortSignal): Promise<CloudCodeModel[] | undefined> {
	let credential: { token?: string; projectId?: string };
	try {
		credential = JSON.parse(apiKey) as { token?: string; projectId?: string };
	} catch {
		return undefined;
	}
	if (!credential.token) return undefined;

	// The endpoint gates on Antigravity's own User-Agent; a bare bearer token answers 403
	// PERMISSION_DENIED. OMP computes that header (and refreshes the version it embeds), so it is
	// imported rather than guessed. Variable specifier keeps OMP out of browser bundles.
	const headersModule = (await import("@oh-my-pi/pi-catalog/wire/gemini-headers")) as {
		getAntigravityHeaders: () => Record<string, string>;
	};
	const response = await fetch(`${ANTIGRAVITY_ENDPOINT}/v1internal:fetchAvailableModels`, {
		method: "POST",
		headers: {
			...headersModule.getAntigravityHeaders(),
			authorization: `Bearer ${credential.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ project: credential.projectId }),
		signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
	}).catch(() => undefined);
	if (!response?.ok) return undefined;

	const body = (await response.json().catch(() => undefined)) as
		| {
				models?: Record<
					string,
					{ displayName?: string; disabled?: boolean; supportsImages?: boolean; maxTokens?: number }
				>;
		  }
		| undefined;
	if (!body?.models) return undefined;

	const discovered: CloudCodeModel[] = [];
	for (const [id, info] of Object.entries(body.models)) {
		// Disabled rows are listed but answer 404; serving them would promise unusable models.
		if (info?.disabled) continue;
		const baseline = ANTIGRAVITY_BASELINE.find((model) => model.id === id);
		discovered.push({
			...(baseline ?? ANTIGRAVITY_BASELINE[0]),
			id,
			name: info.displayName ?? baseline?.name ?? id,
			provider: "google-antigravity",
			input: info.supportsImages === false ? ["text"] : ["text", "image"],
			...(typeof info.maxTokens === "number" ? { maxTokens: info.maxTokens } : {}),
		});
	}
	return discovered.length > 0 ? discovered : undefined;
}

export function googleAntigravityProvider(): Provider<typeof CLOUD_CODE_API> {
	let discovered: CloudCodeModel[] | undefined;
	return createProvider({
		id: "google-antigravity",
		name: "Google Antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		auth: {
			apiKey: envApiKeyAuth("Google Antigravity credential", []),
			oauth: lazyOAuth({
				name: "Google Antigravity",
				isSubscription: true,
				loginLabel: "Sign in with Google",
				load: loadGoogleAntigravityOAuth,
			}),
		},
		models: ANTIGRAVITY_BASELINE,
		api: googleCloudCodeAssistApi(),
		// The roster replaces the baseline once known; a failed discovery keeps it.
		fetchModels: async (context) => {
			if (context.credential?.type !== "oauth" || !context.allowNetwork) return discovered ?? ANTIGRAVITY_BASELINE;
			const apiKey = JSON.stringify({
				token: context.credential.access,
				projectId: context.credential.projectId,
			});
			const roster = await discoverAntigravityModels(apiKey, context.signal ?? new AbortController().signal);
			if (roster) discovered = roster;
			return discovered ?? ANTIGRAVITY_BASELINE;
		},
	});
}

export function googleGeminiCliProvider(): Provider<typeof CLOUD_CODE_API> {
	return createProvider({
		id: "google-gemini-cli",
		name: "Google Gemini CLI",
		baseUrl: GEMINI_CLI_ENDPOINT,
		auth: {
			apiKey: envApiKeyAuth("Google Gemini CLI credential", []),
			oauth: lazyOAuth({
				name: "Google Cloud Code Assist (Gemini CLI)",
				isSubscription: true,
				loginLabel: "Sign in with Google",
				load: loadGoogleGeminiCliOAuth,
			}),
		},
		models: GEMINI_CLI_BASELINE,
		api: googleCloudCodeAssistApi(),
	});
}

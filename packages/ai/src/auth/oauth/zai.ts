/**
 * Z.ai (GLM Coding Plan) sign-in.
 *
 * Z.ai's subscription sign-in ends in a durable `id.secret` API key rather than a refreshable token
 * pair. That end state is why no request-protocol work is needed: the existing `zai` provider already
 * speaks OpenAI and Anthropic to `api.z.ai`, so signing in only has to put the minted key where the
 * provider looks for one.
 *
 * The key provisioning is OMP's `zaiMintKeyHook`, imported rather than reimplemented. It performs the
 * business login, resolves the default organization and project, reuses or creates a named key, and
 * reads the secret — the sequence Z.ai's servers require. Only the authorization-code half is local,
 * because it needs this package's prompt and cancellation semantics.
 *
 * Authorization parameters follow OMP's `auth "zai-coding-plan"` rule: no PKCE, and the `zcode://`
 * callback scheme, since Z.ai rejects loopback redirect URIs for this client.
 */

import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { createOmpLoginController } from "./omp-adapter.ts";

const DEFAULT_CLIENT_ID = "client_P8X5CMWmlaRO9gyO-KSqtg";
const DEFAULT_AUTHORIZE_URL = "https://chat.z.ai/api/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://zcode.z.ai/api/v1/oauth/token";
const DEFAULT_REDIRECT_URI = "zcode://zai-auth/callback";
const REQUEST_TIMEOUT_MS = 30_000;

function env(name: string): string | undefined {
	const value = getProviderEnvValue(name);
	return value && value.length > 0 ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

/**
 * Turn a pasted redirect URL or bare code into the authorization code.
 *
 * The callback uses a custom scheme that no browser can load, so the user copies the redirect URL out
 * of the address bar; a shell may also leave part of the query attached to a bare paste.
 */
export function parseZaiAuthorizationInput(input: string): string | undefined {
	const text = input.trim();
	if (text.length === 0) return undefined;
	try {
		const url = new URL(text);
		return firstString(url.searchParams.get("code"), url.searchParams.get("authCode"));
	} catch {
		return firstString(text.split("&")[0].split("#")[0]);
	}
}

type ZaiTokenResponse = {
	zai?: { access_token?: unknown };
	user?: { email?: unknown; id?: unknown };
};

async function loginZai(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
	const clientId = env("ZAI_OAUTH_CLIENT_ID") ?? DEFAULT_CLIENT_ID;
	const authorizeUrl = env("ZAI_OAUTH_AUTHORIZE_URL") ?? DEFAULT_AUTHORIZE_URL;
	const tokenUrl = env("ZAI_OAUTH_TOKEN_URL") ?? DEFAULT_TOKEN_URL;
	const redirectUri = env("ZAI_OAUTH_REDIRECT_URI") ?? DEFAULT_REDIRECT_URI;
	const state = crypto.randomUUID();

	const url = new URL(authorizeUrl);
	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		state,
	}).toString();
	interaction.notify({
		type: "auth_url",
		url: url.toString(),
		instructions:
			"Complete the Z.ai sign-in in your browser, then paste the final redirect URL (it starts with zcode://) or the authorization code.",
	});

	const pasted = await interaction.prompt({
		type: "manual_code",
		message: "Paste the redirect URL or authorization code:",
		placeholder: redirectUri,
	});
	const code = parseZaiAuthorizationInput(pasted);
	if (!code) throw new Error("Missing authorization code");

	interaction.notify({ type: "progress", message: "Exchanging the authorization code..." });
	const response = await fetch(tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "zai", code, redirect_uri: redirectUri, state }),
		signal: AbortSignal.any([interaction.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`Z.ai token exchange failed (${response.status}): ${text.slice(0, 300)}`);
	}
	let body: ZaiTokenResponse;
	try {
		body = JSON.parse(text) as ZaiTokenResponse;
	} catch {
		throw new Error("Z.ai token exchange returned an unreadable response");
	}
	const accessToken = firstString(body.zai?.access_token);
	if (!accessToken) throw new Error("Z.ai token exchange returned no access token");

	interaction.notify({ type: "progress", message: "Provisioning an API key on your Z.ai account..." });
	// OMP's hook owns the provisioning sequence; only the transport differs.
	//
	// Loaded on demand rather than imported at module scope: the OMP package reaches
	// `@oh-my-pi/pi-utils`, which reads `Bun.env` and parses `.env` files while its module
	// body evaluates. That is fine in the Bun runtime this CLI ships on, but it throws under
	// Node, where the test runner executes. Deferring keeps this module loadable everywhere
	// and only pays the import when a user actually signs in.
	// Variable specifier so bundlers do not follow OMP's Node-only graph into the browser smoke bundle.
	const specifier = "@oh-my-pi/pi-ai/registry/oauth/zai";
	const { zaiMintKeyHook } = (await import(specifier)) as {
		// OMP's credential type has no `type` tag; ours adds it, so strip it at this boundary.
		zaiMintKeyHook: (
			credential: Omit<OAuthCredential, "type">,
			context: unknown,
		) => Promise<Omit<OAuthCredential, "type">>;
	};
	const controller = createOmpLoginController(interaction);
	const minted = await zaiMintKeyHook(
		{ refresh: accessToken, access: accessToken, expires: Number.MAX_SAFE_INTEGER },
		{ provider: "zai", phase: "login", raw: body, fetch: controller.fetch!, signal: interaction.signal },
	);
	const apiKey = firstString(minted.access);
	if (!apiKey) throw new Error("Z.ai key provisioning returned no API key");

	return {
		type: "oauth",
		// The minted key does not expire and Z.ai issues no refresh token, so both fields carry it.
		refresh: apiKey,
		access: apiKey,
		expires: Number.MAX_SAFE_INTEGER,
		...(firstString(body.user?.email) ? { email: firstString(body.user?.email) } : {}),
		...(firstString(body.user?.id) ? { accountId: firstString(body.user?.id) } : {}),
	};
}

export const zaiOAuth: OAuthAuth = {
	name: "Z.AI (GLM Coding Plan · Sign in)",
	isSubscription: true,
	loginLabel: "Sign in with Z.AI",
	login: loginZai,
	// The credential is a durable API key, so there is nothing to refresh.
	async refresh(credential) {
		return credential;
	},
	async toAuth(credential) {
		return { apiKey: credential.access };
	},
};

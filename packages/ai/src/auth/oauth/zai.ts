/**
 * Z.ai (GLM Coding Plan) sign-in.
 *
 * Z.ai's subscription sign-in is an authorization-code flow that ends in a durable `id.secret` API
 * key rather than a refreshable token pair: the OAuth grant is exchanged for a short-lived business
 * token, which then provisions a named key on the account. That end state is why this flow needs no
 * request-protocol work — the existing `zai` provider already speaks OpenAI and Anthropic to
 * `api.z.ai`, so signing in just needs to put the minted key where the provider looks for one.
 *
 * The flow is transcribed from OMP's declarative `auth "zai-coding-plan"` rule so the client id,
 * endpoints, and provisioning sequence match what Z.ai's servers expect. Z.ai rejects loopback
 * redirect URIs for this client, so the callback is the `zcode://` desktop scheme and the code is
 * pasted in by hand.
 */

import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";

const DEFAULT_CLIENT_ID = "client_P8X5CMWmlaRO9gyO-KSqtg";
const DEFAULT_AUTHORIZE_URL = "https://chat.z.ai/api/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://zcode.z.ai/api/v1/oauth/token";
const DEFAULT_REDIRECT_URI = "zcode://zai-auth/callback";
const BIZ_BASE = "https://api.z.ai";
const BUSINESS_LOGIN_URL = `${BIZ_BASE}/api/auth/z/login`;
/** The key name this build creates, so it never mutates another client's key. */
const KEY_NAME = "omp-slim";
const REQUEST_TIMEOUT_MS = 30_000;

function env(name: string): string | undefined {
	const value = getProviderEnvValue(name);
	return value && value.length > 0 ? value : undefined;
}

/** Trim a JSON value to a non-empty string, or undefined. */
function trimmed(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** First non-empty trimmed string among the candidates. */
function pickString(...values: unknown[]): string | undefined {
	for (const value of values) {
		const text = trimmed(value);
		if (text) return text;
	}
	return undefined;
}

/**
 * Z.ai wraps responses in `{ code, msg, data, success }`. The OAuth endpoint uses `code: 0`, the
 * business endpoints `code: 200` / `success: true`; bodies without a wrapper pass through.
 */
function unwrapEnvelope(body: unknown, operation: string): unknown {
	if (!body || typeof body !== "object") return body;
	const envelope = body as { code?: unknown; msg?: string; success?: unknown; data?: unknown };
	if (!("code" in envelope) && !("success" in envelope)) return body;
	const code = envelope.code;
	const ok = code == null || code === 0 || code === 200 || code === "0" || code === "200";
	if (envelope.success === false || !ok) {
		throw new Error(`Z.ai ${operation} failed: ${envelope.msg ?? `code ${String(code)}`}`);
	}
	return "data" in envelope ? envelope.data : envelope;
}

async function requestJson(
	url: string,
	init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string, string> },
	signal: AbortSignal,
): Promise<unknown> {
	const response = await fetch(url, {
		method: init.method,
		headers: { ...init.headers, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
		...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
		signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Z.ai request failed (${response.status}): ${text.slice(0, 300)}`);
	return text.length > 0 ? JSON.parse(text) : undefined;
}

/** Turn a pasted redirect URL or bare code into the authorization code. */
export function parseZaiAuthorizationInput(input: string): string | undefined {
	const text = input.trim();
	if (text.length === 0) return undefined;
	try {
		const url = new URL(text);
		return pickString(url.searchParams.get("code"), url.searchParams.get("authCode"));
	} catch {
		// Not a URL: treat it as the code itself, minus any query the shell left attached.
		return pickString(text.split("&")[0].split("#")[0]);
	}
}

interface ZaiProject {
	projectId?: unknown;
	isDefault?: unknown;
}
interface ZaiOrganization {
	organizationId?: unknown;
	isDefault?: unknown;
	projects?: ZaiProject[];
}

/** Coerce an api-keys response (bare array or a common wrapper) into records. */
function keyRecords(value: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const field of ["list", "keys", "apiKeys", "records"]) {
			if (Array.isArray(record[field])) return record[field] as Array<Record<string, unknown>>;
		}
	}
	return [];
}

/**
 * Provision the durable key from a short-lived OAuth access token: business login, pick the default
 * organization and project, reuse or create this build's key, then read its secret.
 *
 * The secret is always fetched from the copy endpoint because list responses mask it and the create
 * response's inline secret is not reliable across account states.
 */
async function mintApiKey(accessToken: string, signal: AbortSignal): Promise<string> {
	const business = unwrapEnvelope(
		await requestJson(BUSINESS_LOGIN_URL, { method: "POST", body: { token: accessToken } }, signal),
		"business login",
	) as { access_token?: unknown; accessToken?: unknown } | undefined;
	const bizToken = pickString(business?.access_token, business?.accessToken);
	if (!bizToken) throw new Error("Z.ai business login returned no access token");
	const auth = { Authorization: `Bearer ${bizToken}` };

	const customer = unwrapEnvelope(
		await requestJson(`${BIZ_BASE}/api/biz/customer/getCustomerInfo`, { method: "GET", headers: auth }, signal),
		"customer lookup",
	) as { organizations?: ZaiOrganization[] } | undefined;
	const organizations = Array.isArray(customer?.organizations) ? customer.organizations : [];
	const organization = organizations.find((entry) => entry?.isDefault) ?? organizations[0];
	const projects = Array.isArray(organization?.projects) ? organization.projects : [];
	const project = projects.find((entry) => entry?.isDefault) ?? projects[0];
	const organizationId = trimmed(organization?.organizationId);
	const projectId = trimmed(project?.projectId);
	if (!organizationId || !projectId) {
		throw new Error("Z.ai key provisioning failed: the account has no organization or project");
	}

	const keysUrl = `${BIZ_BASE}/api/biz/v1/organization/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/api_keys`;
	const existing = keyRecords(
		unwrapEnvelope(await requestJson(keysUrl, { method: "GET", headers: auth }, signal), "api key list"),
	).find((key) => key.name === KEY_NAME);
	const created =
		existing ??
		(unwrapEnvelope(
			await requestJson(keysUrl, { method: "POST", body: { name: KEY_NAME }, headers: auth }, signal),
			"api key create",
		) as Record<string, unknown> | undefined);
	const apiKey = trimmed(created?.apiKey);
	if (!apiKey) throw new Error("Z.ai key provisioning returned no apiKey");

	const copied = unwrapEnvelope(
		await requestJson(`${keysUrl}/copy/${encodeURIComponent(apiKey)}`, { method: "GET", headers: auth }, signal),
		"api key copy",
	) as { secretKey?: unknown } | undefined;
	const secretKey = trimmed(copied?.secretKey);
	if (!secretKey) throw new Error("Z.ai key provisioning returned no secretKey");

	return `${apiKey}.${secretKey}`;
}

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
	const token = unwrapEnvelope(
		await requestJson(
			tokenUrl,
			{
				method: "POST",
				body: { provider: "zai", code, redirect_uri: redirectUri, state },
			},
			interaction.signal,
		),
		"token exchange",
	) as { zai?: { access_token?: unknown }; user?: { email?: unknown; id?: unknown } } | undefined;
	const accessToken = pickString(token?.zai?.access_token);
	if (!accessToken) throw new Error("Z.ai token exchange returned no access token");

	interaction.notify({ type: "progress", message: "Provisioning an API key on your Z.ai account..." });
	const apiKey = await mintApiKey(accessToken, interaction.signal);

	return {
		type: "oauth",
		// The minted key does not expire and Z.ai issues no refresh token, so both fields carry it.
		refresh: apiKey,
		access: apiKey,
		expires: Number.MAX_SAFE_INTEGER,
		email: pickString(token?.user?.email),
		accountId: pickString(token?.user?.id),
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

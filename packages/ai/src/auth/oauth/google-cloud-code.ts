/**
 * Google Cloud Code Assist sign-in: `google-gemini-cli` and `google-antigravity`.
 *
 * Both providers authenticate the same way — Google OAuth, then a Cloud Code Assist provisioning
 * call that binds the grant to a cloud project — and differ only in the client, the tiers they
 * accept, and the endpoints they serve afterwards. The authorization half is local so it can use this
 * package's prompt and cancellation semantics; project provisioning is imported from OMP
 * (`googleGeminiCliProjectHook`, `googleAntigravityProjectHook`) because it polls long-running
 * operations and interprets tier eligibility, which is provider server behaviour worth sharing.
 *
 * The resulting credential is the JSON blob the transport expects: `access`, `refresh`, `expires`,
 * and the provisioned `projectId`.
 */

import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { startOAuthCallbackServer, waitForCallbackOrManualInput } from "./callback-server.ts";
import { createOmpLoginController } from "./omp-adapter.ts";
import { generatePKCE } from "./pkce.ts";

/** Client identifiers published in OMP's declarative auth rules, base64-encoded there. */
const GEMINI_CLI_CLIENT_ID = Buffer.from(
	"NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
	"base64",
).toString();
const GEMINI_CLI_CLIENT_SECRET = Buffer.from("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=", "base64").toString();
/** Antigravity ships its own client; it is not published in a declarative rule. */
const ANTIGRAVITY_CLIENT_ID = GEMINI_CLI_CLIENT_ID;
const ANTIGRAVITY_CLIENT_SECRET = GEMINI_CLI_CLIENT_SECRET;

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
];
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CALLBACK_PORT = 8085;
const DEFAULT_CALLBACK_PATH = "/oauth2callback";

type GoogleTokenResponse = {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
};

type GoogleUserInfo = { email?: string };

type GoogleFlow = {
	providerId: "google-gemini-cli" | "google-antigravity";
	displayName: string;
	clientId: string;
	clientSecret: string;
	/** Resolved on demand; see the note on `loadProjectHook`. */
	projectHook: "google-gemini-cli-project" | "google-antigravity-project";
};

/**
 * Load the provisioning hook from OMP at call time.
 *
 * The OMP package reaches `@oh-my-pi/pi-utils`, which reads `Bun.env` and `bun:ffi` while its module
 * body evaluates. Importing it at module scope would make this file — and therefore `pi-ai`'s root
 * export — unusable in Node tests and in the browser smoke bundle. Deferring keeps the module graph
 * browser- and Node-safe and pays the cost only during an actual sign-in.
 */
async function loadProjectHook(name: GoogleFlow["projectHook"]) {
	// Variable specifiers keep bundlers from following OMP's Node-only graph; see the note above.
	const specifier =
		name === "google-gemini-cli-project"
			? "@oh-my-pi/pi-ai/registry/oauth/google-gemini-cli"
			: "@oh-my-pi/pi-ai/registry/oauth/google-antigravity";
	const module = (await import(specifier)) as {
		googleGeminiCliProjectHook?: unknown;
		googleAntigravityProjectHook?: unknown;
	};
	const hook = module.googleGeminiCliProjectHook ?? module.googleAntigravityProjectHook;
	if (!hook) throw new Error(`OMP does not export the ${name} hook`);
	return hook as (credential: OAuthCredential, context: unknown) => Promise<OAuthCredential>;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function exchangeCode(
	code: string,
	verifier: string,
	redirectUri: string,
	flow: GoogleFlow,
	signal: AbortSignal,
): Promise<{ credential: OAuthCredential; raw: unknown }> {
	const body = new URLSearchParams({
		code,
		client_id: flow.clientId,
		client_secret: flow.clientSecret,
		redirect_uri: redirectUri,
		grant_type: "authorization_code",
		code_verifier: verifier,
	});
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
		signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Google token exchange failed (${response.status}): ${text.slice(0, 300)}`);
	const token = JSON.parse(text) as GoogleTokenResponse;
	if (!token.access_token) throw new Error("Google token exchange returned no access token");

	const userInfo = await fetch(USERINFO_URL, {
		headers: { authorization: `Bearer ${token.access_token}` },
		signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
	})
		.then(async (res) => (res.ok ? ((await res.json()) as GoogleUserInfo) : undefined))
		.catch(() => undefined);

	const expiresInSeconds = typeof token.expires_in === "number" ? token.expires_in : 3600;
	return {
		credential: {
			type: "oauth",
			refresh: token.refresh_token ?? "",
			access: token.access_token,
			// Refreshed a few minutes early so a token never expires mid-request.
			expires: Date.now() + expiresInSeconds * 1000 - 5 * 60 * 1000,
			...(userInfo?.email ? { email: userInfo.email } : {}),
		},
		raw: token,
	};
}

async function loginWithGoogle(flow: GoogleFlow, interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
	const { verifier, challenge } = await generatePKCE();
	const callback = await startOAuthCallbackServer({
		providerName: flow.displayName,
		host: "127.0.0.1",
		port: DEFAULT_CALLBACK_PORT,
		path: DEFAULT_CALLBACK_PATH,
		complete: async (code: string) => exchangeCode(code, verifier, "", flow, interaction.signal),
		signal: interaction.signal,
		timeoutMs: LOGIN_TIMEOUT_MS,
		// The redirect URI depends on the port actually bound, so the exchange is completed below.
	});

	try {
		const authorize = new URL(AUTHORIZE_URL);
		authorize.search = new URLSearchParams({
			client_id: flow.clientId,
			redirect_uri: callback.redirectUri,
			response_type: "code",
			scope: SCOPES.join(" "),
			code_challenge: challenge,
			code_challenge_method: "S256",
			access_type: "offline",
			prompt: "consent",
		}).toString();
		interaction.notify({
			type: "auth_url",
			url: authorize.toString(),
			instructions: `Complete the sign-in in your browser. If it runs on another machine, paste the final redirect URL here.`,
		});

		const result = await waitForCallbackOrManualInput(interaction, callback, {
			message: "Complete sign-in in your browser, or paste the redirect URL here:",
			placeholder: callback.redirectUri,
		});
		const { credential, raw } =
			result.type === "callback"
				? result.value
				: await exchangeCode(
						new URL(result.input).searchParams.get("code") ?? result.input.trim(),
						verifier,
						callback.redirectUri,
						flow,
						interaction.signal,
					);

		interaction.notify({ type: "progress", message: "Binding the sign-in to a Cloud Code project..." });
		const controller = createOmpLoginController(interaction);
		const projectHook = await loadProjectHook(flow.projectHook);
		const provisioned = await projectHook(credential, {
			provider: flow.providerId,
			phase: "login",
			raw,
			fetch: controller.fetch!,
			signal: interaction.signal,
			onProgress: controller.onProgress,
			onPrompt: controller.onPrompt,
		});
		return {
			...credential,
			...(provisioned.projectId ? { projectId: provisioned.projectId } : {}),
			expires: provisioned.expires ?? credential.expires,
		} as OAuthCredential;
	} catch (error) {
		throw new Error(`${flow.displayName} sign-in failed: ${describe(error)}`);
	} finally {
		callback.close();
	}
}

const GEMINI_CLI_FLOW: GoogleFlow = {
	providerId: "google-gemini-cli",
	displayName: "Google Cloud Code Assist (Gemini CLI)",
	clientId: GEMINI_CLI_CLIENT_ID,
	clientSecret: GEMINI_CLI_CLIENT_SECRET,
	projectHook: "google-gemini-cli-project",
};

const ANTIGRAVITY_FLOW: GoogleFlow = {
	providerId: "google-antigravity",
	displayName: "Google Antigravity",
	clientId: ANTIGRAVITY_CLIENT_ID,
	clientSecret: ANTIGRAVITY_CLIENT_SECRET,
	projectHook: "google-antigravity-project",
};

/** Shared refresh: Google rotates only the access token; the provisioning stays bound to the project. */
async function refreshGoogle(
	credential: OAuthCredential,
	signal: AbortSignal,
	flow: GoogleFlow,
): Promise<OAuthCredential> {
	if (!credential.refresh) return credential;
	const body = new URLSearchParams({
		client_id: flow.clientId,
		client_secret: flow.clientSecret,
		refresh_token: credential.refresh,
		grant_type: "refresh_token",
	});
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: body.toString(),
		signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Google token refresh failed (${response.status}): ${text.slice(0, 300)}`);
	const token = JSON.parse(text) as GoogleTokenResponse;
	if (!token.access_token) throw new Error("Google token refresh returned no access token");
	const expiresInSeconds = typeof token.expires_in === "number" ? token.expires_in : 3600;
	return {
		...credential,
		access: token.access_token,
		expires: Date.now() + expiresInSeconds * 1000 - 5 * 60 * 1000,
	};
}

/**
 * The credential JSON the Cloud Code transport reads from `apiKey`.
 *
 * Field names follow the transport's parser, which reads `token` (not `access`) plus `projectId`; it
 * also accepts `refreshToken` and `expiresAt` aliases, used here so a refresh keeps working.
 */
function toApiKey(credential: OAuthCredential): string {
	return JSON.stringify({
		token: credential.access,
		refreshToken: credential.refresh,
		expiresAt: credential.expires,
		projectId: credential.projectId,
		email: credential.email,
	});
}

export const googleGeminiCliOAuth: OAuthAuth = {
	name: GEMINI_CLI_FLOW.displayName,
	isSubscription: true,
	loginLabel: "Sign in with Google",
	login: (interaction) => loginWithGoogle(GEMINI_CLI_FLOW, interaction),
	refresh: (credential, signal) => refreshGoogle(credential, signal, GEMINI_CLI_FLOW),
	async toAuth(credential) {
		return { apiKey: toApiKey(credential) };
	},
};

export const googleAntigravityOAuth: OAuthAuth = {
	name: ANTIGRAVITY_FLOW.displayName,
	isSubscription: true,
	loginLabel: "Sign in with Google",
	login: (interaction) => loginWithGoogle(ANTIGRAVITY_FLOW, interaction),
	refresh: (credential, signal) => refreshGoogle(credential, signal, ANTIGRAVITY_FLOW),
	async toAuth(credential) {
		return { apiKey: toApiKey(credential) };
	},
};

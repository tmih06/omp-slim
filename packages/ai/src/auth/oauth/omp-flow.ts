/**
 * Sign-in flows whose end state is an API key for a provider this build already serves.
 *
 * OMP exports these as `login*()` functions returning a bare `string` (the key) or an
 * `OAuthCredentials` object. None of them needs new request-protocol work: Kilo, Xiaomi, Alibaba,
 * Cloudflare, Snowflake, Perplexity and Mistral all speak APIs this package already implements, so the
 * only missing piece was the interactive step that obtains the credential.
 *
 * One factory covers them, because the differences are data:
 * - `kind: "apiKey"` wraps a key so the provider's existing `toAuth` uses it unchanged.
 * - `kind: "oauth"` passes OMP's credential through, keeping the identity fields it returns.
 *
 * Their functions take OMP's own controller, which `createOmpLoginController` supplies.
 */

import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { createOmpLoginController } from "./omp-adapter.ts";

/** What one exported flow returns, from this build's point of view. */
type FlowKind = "apiKey" | "oauth";

type FlowSpec = {
	/** Display name shown in `/login`. */
	name: string;
	/** Export name inside the OMP module. */
	exportName: string;
	/** OMP subpath that exports the function. */
	module: string;
	kind: FlowKind;
	/** Subscription sign-in (a plan) rather than a plain account. */
	isSubscription?: boolean;
	loginLabel?: string;
	/**
	 * Statically imported login function, supplied by the standalone binary.
	 *
	 * A compiled binary cannot resolve a bare package specifier at runtime, so the bundled path hands
	 * the function in directly. Without it the flow falls back to a variable dynamic import, which is
	 * what keeps this module browser-safe.
	 */
	login?: (ctrl: unknown) => Promise<unknown>;
};

/** A credential OMP returns; `type` is added by this package, not theirs. */
type OmpCredential = {
	access: string;
	refresh?: string;
	expires?: number;
	[key: string]: unknown;
};

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Build an `OAuthAuth` around one of OMP's exported login functions.
 *
 * The key case stores the returned string in both `access` and `refresh` and never expires it: the
 * provider's `toAuth` reads `access`, and there is nothing to refresh.
 */
export function createOmpFlow(spec: FlowSpec, displayName: string): OAuthAuth {
	return {
		name: spec.name,
		...(spec.isSubscription === false ? { isSubscription: false } : { isSubscription: true }),
		...(spec.loginLabel ? { loginLabel: spec.loginLabel } : {}),
		async login(interaction: ProviderAuthInteraction): Promise<OAuthCredential> {
			// A compiled binary cannot resolve a bare specifier at runtime, so the bundled path supplies
			// the function. Otherwise import with a variable specifier, which keeps bundlers from
			// following OMP's Node-only graph into browser bundles.
			let login: unknown = spec.login;
			if (!login) {
				const module = (await import(spec.module)) as Record<string, unknown>;
				login = module[spec.exportName];
			}
			if (typeof login !== "function") {
				throw new Error(`${displayName} sign-in is unavailable: OMP does not export ${spec.exportName}`);
			}
			const controller = createOmpLoginController(interaction);
			let result: unknown;
			try {
				result = await (login as (ctrl: unknown) => Promise<unknown>)(controller);
			} catch (error) {
				throw new Error(`${displayName} sign-in failed: ${describe(error)}`);
			}

			if (typeof result === "string") {
				const key = result.trim();
				if (!key) throw new Error(`${displayName} sign-in returned an empty credential`);
				return {
					type: "oauth",
					// The provider's `toAuth` reads `access`; a key never expires and is never refreshed.
					refresh: key,
					access: key,
					expires: Number.MAX_SAFE_INTEGER,
				};
			}

			const credential = result as OmpCredential | undefined;
			if (!credential?.access) throw new Error(`${displayName} sign-in returned no access token`);
			return {
				type: "oauth",
				refresh: credential.refresh ?? "",
				access: credential.access,
				expires: credential.expires ?? Number.MAX_SAFE_INTEGER,
				// Identity fields ride along so account selection and labels keep working.
				...Object.fromEntries(
					Object.entries(credential).filter(
						([key]) => key !== "access" && key !== "refresh" && key !== "expires" && key !== "type",
					),
				),
			} as OAuthCredential;
		},
		// A minted key has nothing to refresh; a rotating grant keeps whatever OMP issued.
		async refresh(credential) {
			return credential;
		},
		async toAuth(credential) {
			return { apiKey: credential.access };
		},
	};
}

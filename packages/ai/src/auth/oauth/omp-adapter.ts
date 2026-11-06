/**
 * Adapter from OMP's OAuth login controller to this package's `ProviderAuthInteraction`.
 *
 * OMP's flows are exported as plain functions (`loginKilo`, `loginSnowflake`, `zaiMintKeyHook`, …)
 * rather than as ready-made auth objects, and they talk to their own controller shape: `onPrompt`,
 * `onAuth`, `onProgress`, `onManualCodeInput`, `signal`, `fetch`. This module supplies that shape
 * from ours, so a flow can be imported and run without rewriting it.
 *
 * The two shapes differ where it matters:
 * - Our `AuthPrompt` is a discriminated union; theirs is `{ message, placeholder?, secret?, allowEmpty? }`.
 *   The adapters below translate in both directions, including our `select` prompt, which theirs has no
 *   equivalent for (it is answered as a one-off text prompt listing the option ids).
 * - Their flows throw their own cancellation and prompt-required errors. Those are rethrown as plain
 *   `Error`s so callers see one error type, which is what `OAuthAuth` expects.
 *
 * Nothing here mirrors business logic: every provider-specific step stays in the imported flow.
 */

import type { AuthPrompt, ProviderAuthInteraction } from "../types.ts";

/** The controller shape OMP login functions accept, narrowed to what this adapter provides. */
export interface OmpLoginController {
	onAuth?(info: { url: string; instructions?: string }): void;
	onProgress?(message: string): void;
	onManualCodeInput?(signal?: AbortSignal): Promise<string>;
	onPrompt?(prompt: {
		message: string;
		placeholder?: string;
		allowEmpty?: boolean;
		secret?: boolean;
	}): Promise<string>;
	signal?: AbortSignal;
	fetch?: typeof fetch;
}

/** Credential fields both sides share; OMP's optional identity fields ride along untouched. */
export type OmpOAuthCredential = {
	refresh: string;
	access: string;
	expires: number;
	[key: string]: unknown;
};

/** Their prompt as ours: masked entry stays secret, everything else is plain text. */
function ompPromptToOurs(prompt: { message: string; placeholder?: string; secret?: boolean }): AuthPrompt {
	return prompt.secret
		? { type: "secret", message: prompt.message, placeholder: prompt.placeholder }
		: { type: "text", message: prompt.message, placeholder: prompt.placeholder };
}

/**
 * Build the controller one OMP login call needs.
 *
 * `onAuth` becomes our `auth_url` event so the UI shows the same link it would for a native flow;
 * `onProgress` becomes `progress`; `onManualCodeInput` reuses our `manual_code` prompt.
 */
export function createOmpLoginController(interaction: ProviderAuthInteraction): OmpLoginController {
	return {
		signal: interaction.signal,
		fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
		onAuth: (info) => {
			interaction.notify({ type: "auth_url", url: info.url, instructions: info.instructions });
		},
		onProgress: (message) => {
			interaction.notify({ type: "progress", message });
		},
		onPrompt: async (prompt) => {
			const answer = await interaction.prompt(ompPromptToOurs(prompt));
			if (!prompt.allowEmpty && answer.trim().length === 0) {
				throw new Error("A value is required.");
			}
			return answer;
		},
		onManualCodeInput: async () =>
			interaction.prompt({
				type: "manual_code",
				message: "Paste the redirect URL or authorization code:",
			}),
	};
}

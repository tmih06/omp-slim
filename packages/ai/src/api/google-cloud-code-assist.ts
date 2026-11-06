/**
 * Cloud Code Assist transport, adapted from OMP rather than reimplemented.
 *
 * Google's Cloud Code Assist endpoint (`/v1internal:streamGenerateContent`) is not the public
 * Gemini API: requests carry a provisioned project, an account-scoped session id, and Antigravity
 * expects its own tool and thinking shapes. OMP implements that wire (≈1,400 lines of request
 * building, SSE parsing, retry and markup healing), so this module imports it and translates at the
 * boundary instead of maintaining a second copy.
 *
 * The only work here is the boundary:
 * - Our `Model` carries the model facts; theirs expects provider-specific `compat` knobs, filled in
 *   below so an unmodified catalog entry works.
 * - Their credential is a JSON string (access token + project) resolved at request time; ours arrives
 *   as `options.apiKey`, which already holds that string.
 * - Their options mirror ours closely enough to pass through: temperature, max tokens, thinking.
 *
 * The returned stream is their `AssistantMessageEventStream`, which satisfies our
 * `AssistantMessageEventStream` contract (async-iterable, `result()`, same event union), so callers
 * consume it unchanged.
 */

import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	SimpleStreamOptions,
	StreamOptions,
	TranscriptContext,
} from "../types.ts";

/**
 * Load OMP's Cloud Code transport on first use.
 *
 * It statically reaches `@oh-my-pi/pi-utils`, which imports `bun:ffi` and reads `Bun.env` in its module
 * body. A module-scope import would make this file — and therefore `pi-ai`'s root export — fail to
 * bundle for the browser and throw under Node. Cached so repeat requests pay nothing.
 */
type CloudCodeTransport = {
	streamGoogleGeminiCli: (...args: unknown[]) => unknown;
};

let transport: Promise<CloudCodeTransport> | undefined;

function loadTransport(): Promise<CloudCodeTransport> {
	// A variable specifier, so bundlers cannot follow this into OMP. Its module graph needs `bun:ffi`
	// and `Bun.env`, which would break the browser and Node smoke bundles; the specifier is resolved
	// only when a Cloud Code request actually runs.
	const specifier = "@oh-my-pi/pi-ai/providers/google-gemini-cli";
	transport ??= import(specifier) as unknown as Promise<CloudCodeTransport>;
	return transport;
}

/** Cloud Code endpoints; Antigravity fails over to the sandbox host. */
export const ANTIGRAVITY_PRIMARY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const GEMINI_CLI_ENDPOINT = "https://cloudcode-pa.googleapis.com";

/**
 * Provider-specific knobs OMP reads off `model.compat`. Our catalog does not model them, and they are
 * only consulted for Antigravity request shaping, so an empty object is the correct default rather
 * than a stub that pretends to carry data.
 */
const CLOUD_CODE_COMPAT = { antigravityUsageLabel: {}, antigravityWireProfiles: {} } as const;

/**
 * Build the model object their transport expects.
 *
 * `identity.class` selects the request dialect (Gemini vs Claude rows on Antigravity); the catalog id
 * decides it, matching how OMP tags its own rows.
 */
function toCloudCodeModel(model: Model<Api>) {
	const id = model.id.toLowerCase();
	const identityClass = id.includes("claude") ? "anthropic" : id.includes("gpt-oss") ? "openai" : "gemini";
	const isAntigravity = model.provider === "google-antigravity";
	return {
		id: model.id,
		name: model.name ?? model.id,
		provider: model.provider,
		api: model.api,
		baseUrl: model.baseUrl ?? (isAntigravity ? ANTIGRAVITY_PRIMARY_ENDPOINT : GEMINI_CLI_ENDPOINT),
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		reasoning: model.reasoning ?? false,
		input: model.input ?? ["text"],
		cost: model.cost,
		identity: { class: identityClass },
		compat: CLOUD_CODE_COMPAT,
		// Their `Model` requires provider-internal `compat` values our catalog does not model; the
		// fields this adapter supplies are the only ones their transport reads for these providers.
	};
}

/** Map our stream options onto theirs; the fields they share are passed through. */
function toCloudCodeOptions(options: StreamOptions | undefined) {
	return {
		apiKey: options?.apiKey,
		signal: options?.signal,
		temperature: options?.temperature,
		maxTokens: options?.maxTokens,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
	};
}

/**
 * Stream a Cloud Code Assist request.
 *
 * Requires an OAuth credential: `options.apiKey` must be the JSON blob holding `token` and
 * `projectId`. Without one the transport reports a configuration error, which is correct — Cloud Code
 * has no API-key mode.
 *
 * `stream` must return synchronously, but the transport loads asynchronously, so this hands back our
 * own stream immediately and pumps their events into it once the module resolves. Callers iterate
 * events as they would for any other provider; the first request absorbs the import cost.
 */
export const streamCloudCodeAssist = (
	model: Model<Api>,
	context: TranscriptContext,
	options?: StreamOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	void (async () => {
		try {
			const transport = await loadTransport();
			// Their event and message types differ from ours by two additions only: `StopReason` gains
			// `pending` and `deferred`, and their stream carries private timing fields. Their converters
			// read `role` and `content` alone, so nothing narrower is observed in either direction.
			const source = transport.streamGoogleGeminiCli(
				toCloudCodeModel(model),
				context,
				toCloudCodeOptions(options),
			) as AsyncIterable<AssistantMessageEvent>;
			for await (const event of source) stream.push(event);
		} catch (error) {
			stream.push({ type: "error", reason: "error", error: failureMessage(model, error) });
		}
	})();

	return stream;
};

/** Minimal failed message, so a transport error surfaces as a normal stream error. */
function failureMessage(model: Model<Api>, error: unknown): AssistantMessage {
	const message = error instanceof Error ? error.message : String(error);
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: message,
		timestamp: Date.now(),
	};
}

/** Export name the API registry expects. */
export const stream = streamCloudCodeAssist;

/**
 * Simple entry point: Cloud Code needs a provisioned credential, so the only addition over `stream`
 * is rejecting a request with no credential up front instead of failing inside the transport.
 */
export const streamSimple = (
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	if (!options?.apiKey) {
		throw new Error(`No Cloud Code Assist credential for provider: ${model.provider}. Run /login.`);
	}
	return streamCloudCodeAssist(model, context, options);
};

import type { ChatModel } from "../define.ts";
import { defineProvider } from "../define.ts";

/**
 * Google Antigravity through Cloud Code Assist.
 *
 * Models are authored here rather than taken from models.dev: Cloud Code exposes its own ids and the
 * account's served roster is discovered at request time (`fetchModels` in the provider), so only rows
 * that are always available are declared. Prices are zero because the subscription covers them.
 */
const ANTIGRAVITY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const API = "google-gemini-cli" as const;

function antigravityModel(id: string, name: string, contextWindow: number): ChatModel {
	return {
		id,
		name,
		api: API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 64_000,
	};
}

export default defineProvider({
	id: "google-antigravity",
	models: () => [antigravityModel("gemini-3.1-pro", "Gemini 3.1 Pro", 200_000)],
});

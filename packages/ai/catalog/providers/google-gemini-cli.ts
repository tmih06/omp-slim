import type { ChatModel } from "../define.ts";
import { defineProvider } from "../define.ts";

/**
 * Google Gemini CLI through Cloud Code Assist.
 *
 * Cloud Code serves the CLI's own model ids, so the catalog declares them directly instead of mapping
 * models.dev entries that use public Gemini API names. Prices are zero because the subscription covers
 * them.
 */
const GEMINI_CLI_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const API = "google-gemini-cli" as const;

export default defineProvider({
	id: "google-gemini-cli",
	models: (): ChatModel[] => [
		{
			id: "gemini-3.1-pro-preview",
			name: "Gemini 3.1 Pro (Preview)",
			api: API,
			provider: "google-gemini-cli",
			baseUrl: GEMINI_CLI_ENDPOINT,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 64_000,
		},
	],
});

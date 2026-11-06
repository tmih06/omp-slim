import type { ChatModel } from "../define.ts";
import { defineProvider } from "../define.ts";

/**
 * Google Antigravity through Cloud Code Assist.
 *
 * The roster is account-scoped: Cloud Code's `fetchAvailableModels` is authoritative and rows an
 * account is not served 404 on every request. The list here is the set Antigravity serves today, and
 * the provider replaces it with the account's own roster when it can reach the network. Offline, this
 * baseline is what `/model` shows, so it stays current rather than minimal.
 */
const ANTIGRAVITY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const API = "google-gemini-cli" as const;

function antigravityModel(id: string, name: string, reasoning: boolean, input: ("text" | "image")[]): ChatModel {
	return {
		id,
		name,
		api: API,
		provider: "google-antigravity",
		baseUrl: ANTIGRAVITY_ENDPOINT,
		reasoning,
		input,
		// Covered by the subscription, so no per-token price.
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	};
}

export default defineProvider({
	id: "google-antigravity",
	models: () => [
		antigravityModel("gemini-3.8-flash-high", "Gemini 3.8 Flash High", true, ["text", "image"]),
		antigravityModel("gemini-3.8-flash-medium", "Gemini 3.8 Flash Medium", true, ["text", "image"]),
		antigravityModel("gemini-3.8-flash-low", "Gemini 3.8 Flash Low", true, ["text", "image"]),
		antigravityModel("gemini-3.8-flash-tiered", "Gemini 3.8 Flash Tiered", true, ["text", "image"]),
		antigravityModel("gemini-3.1-pro", "Gemini 3.1 Pro", true, ["text", "image"]),
		antigravityModel("gemini-3-flash", "Gemini 3 Flash", true, ["text", "image"]),
		antigravityModel("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", true, ["text"]),
		antigravityModel("gemini-3.1-flash-image", "Gemini 3.1 Flash Image", false, ["text", "image"]),
		antigravityModel("gemini-2.5-pro", "Gemini 2.5 Pro", true, ["text", "image"]),
		antigravityModel("gemini-2.5-flash", "Gemini 2.5 Flash", true, ["text", "image"]),
		antigravityModel("gemini-2.5-flash-thinking", "Gemini 2.5 Flash Thinking", true, ["text", "image"]),
		antigravityModel("claude-sonnet-4-6", "Claude Sonnet 4 6", true, ["text"]),
		antigravityModel("claude-opus-4-6-thinking", "Claude Opus 4 6 Thinking", true, ["text"]),
		antigravityModel("gpt-oss-120b-medium", "GPT-OSS 120B Medium", true, ["text"]),
	],
});

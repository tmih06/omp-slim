import { registerBundledOAuthFlowLoaders } from "./auth/oauth/load.ts";
import { createOmpFlow } from "./auth/oauth/omp-flow.ts";

/**
 * Registers OAuth flow loaders with literal dynamic imports, for Node bundles
 * that split at dynamic imports (esbuild `splitting`, Chord's worker base):
 * each flow lands in a chunk loaded on its first use, inside the bundle.
 * Without it, pi-ai imports the flows through a variable specifier that
 * bundlers cannot follow, so a bundle loads them from pi-ai's own files.
 * Browser bundles must not import this module (the flows are Node-only).
 */
export function registerLazyOAuthFlows(): void {
	registerBundledOAuthFlowLoaders({
		anthropic: async () => (await import("./auth/oauth/anthropic.ts")).anthropicOAuth,
		openaiCodex: async () => (await import("./auth/oauth/openai-codex.ts")).openaiCodexOAuth,
		openaiChatGPT: async () => (await import("./auth/oauth/openai-chatgpt.ts")).openaiChatGPTOAuth,
		githubCopilot: async () => (await import("./auth/oauth/github-copilot.ts")).githubCopilotOAuth,
		openrouter: async () => (await import("./auth/oauth/openrouter.ts")).openRouterOAuth,
		kimiCoding: async () => (await import("./auth/oauth/kimi-coding.ts")).kimiCodingOAuth,
		meta: async () => (await import("./auth/oauth/meta.ts")).metaOAuth,
		xai: async () => (await import("./auth/oauth/xai.ts")).xaiOAuth,
		zai: async () => (await import("./auth/oauth/zai.ts")).zaiOAuth,
		kilo: async () =>
			createOmpFlow(
				{
					name: "Kilo Gateway",
					exportName: "loginKilo",
					module: "@oh-my-pi/pi-ai/registry/oauth/kilo",
					kind: "apiKey",
				},
				"Kilo Gateway",
			),
		xiaomi: async () =>
			createOmpFlow(
				{
					name: "Xiaomi MiMo",
					exportName: "loginXiaomi",
					module: "@oh-my-pi/pi-ai/registry/oauth/xiaomi",
					kind: "apiKey",
				},
				"Xiaomi MiMo",
			),
		alibabaCodingPlan: async () =>
			createOmpFlow(
				{
					name: "Alibaba Coding Plan",
					exportName: "loginAlibabaCodingPlan",
					module: "@oh-my-pi/pi-ai/registry/oauth/alibaba-coding-plan",
					kind: "apiKey",
				},
				"Alibaba Coding Plan",
			),
		alibabaTokenPlan: async () =>
			createOmpFlow(
				{
					name: "QwenCloud Token Plan",
					exportName: "loginAlibabaTokenPlan",
					module: "@oh-my-pi/pi-ai/registry/oauth/alibaba-token-plan",
					kind: "apiKey",
				},
				"QwenCloud Token Plan",
			),
		perplexity: async () =>
			createOmpFlow(
				{
					name: "Perplexity",
					exportName: "loginPerplexity",
					module: "@oh-my-pi/pi-ai/registry/oauth/perplexity",
					kind: "apiKey",
				},
				"Perplexity",
			),
		snowflake: async () =>
			createOmpFlow(
				{
					name: "Snowflake",
					exportName: "loginSnowflake",
					module: "@oh-my-pi/pi-ai/registry/oauth/snowflake",
					kind: "apiKey",
				},
				"Snowflake",
			),
		cloudflareWorkersAi: async () =>
			createOmpFlow(
				{
					name: "Cloudflare Workers AI",
					exportName: "loginCloudflareWorkersAi",
					module: "@oh-my-pi/pi-ai/registry/oauth/cloudflare-workers-ai",
					kind: "apiKey",
				},
				"Cloudflare Workers AI",
			),
		cloudflareAiGateway: async () =>
			createOmpFlow(
				{
					name: "Cloudflare AI Gateway",
					exportName: "loginCloudflareAiGateway",
					module: "@oh-my-pi/pi-ai/registry/oauth/cloudflare-ai-gateway",
					kind: "apiKey",
				},
				"Cloudflare AI Gateway",
			),
		mistralVibe: async () =>
			createOmpFlow(
				{
					name: "Mistral",
					exportName: "loginMistralVibeSignIn",
					module: "@oh-my-pi/pi-ai/registry/oauth/mistral-vibe",
					kind: "apiKey",
				},
				"Mistral",
			),
		cursor: async () =>
			createOmpFlow(
				{
					name: "Cursor",
					exportName: "loginCursor",
					module: "@oh-my-pi/pi-ai/registry/oauth/cursor",
					kind: "apiKey",
				},
				"Cursor",
			),
		googleGeminiCli: async () => (await import("./auth/oauth/google-cloud-code.ts")).googleGeminiCliOAuth,
		googleAntigravity: async () => (await import("./auth/oauth/google-cloud-code.ts")).googleAntigravityOAuth,
		radius: async (options) => (await import("./auth/oauth/radius.ts")).createRadiusOAuth(options),
	});
}

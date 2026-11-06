import { anthropicOAuth } from "./auth/oauth/anthropic.ts";
import { githubCopilotOAuth } from "./auth/oauth/github-copilot.ts";
import { kimiCodingOAuth } from "./auth/oauth/kimi-coding.ts";
import { registerBundledOAuthFlowLoaders } from "./auth/oauth/load.ts";
import { metaOAuth } from "./auth/oauth/meta.ts";
import { openaiChatGPTOAuth } from "./auth/oauth/openai-chatgpt.ts";
import { openaiCodexOAuth } from "./auth/oauth/openai-codex.ts";
import { openRouterOAuth } from "./auth/oauth/openrouter.ts";
import { createRadiusOAuth } from "./auth/oauth/radius.ts";
import { xaiOAuth } from "./auth/oauth/xai.ts";
import { googleAntigravityOAuth, googleGeminiCliOAuth } from "./auth/oauth/google-cloud-code.ts";
import { loginKilo } from "@oh-my-pi/pi-ai/registry/oauth/kilo";
import { loginXiaomi } from "@oh-my-pi/pi-ai/registry/oauth/xiaomi";
import { loginAlibabaCodingPlan } from "@oh-my-pi/pi-ai/registry/oauth/alibaba-coding-plan";
import { loginAlibabaTokenPlan } from "@oh-my-pi/pi-ai/registry/oauth/alibaba-token-plan";
import { loginCloudflareWorkersAi } from "@oh-my-pi/pi-ai/registry/oauth/cloudflare-workers-ai";
import { loginCloudflareAiGateway } from "@oh-my-pi/pi-ai/registry/oauth/cloudflare-ai-gateway";
import { loginMistralVibeSignIn } from "@oh-my-pi/pi-ai/registry/oauth/mistral-vibe";
import { createOmpFlow } from "./auth/oauth/omp-flow.ts";
import { zaiOAuth } from "./auth/oauth/zai.ts";

/** Register OAuth flows statically embedded in the standalone Bun binary. */
export function registerBunOAuthFlows(): void {
	registerBundledOAuthFlowLoaders({
		anthropic: () => anthropicOAuth,
		openaiCodex: () => openaiCodexOAuth,
		openaiChatGPT: () => openaiChatGPTOAuth,
		githubCopilot: () => githubCopilotOAuth,
		openrouter: () => openRouterOAuth,
		kimiCoding: () => kimiCodingOAuth,
		meta: () => metaOAuth,
		xai: () => xaiOAuth,
		zai: () => zaiOAuth,
		kilo: () =>
			createOmpFlow(
				{
					name: "Kilo Gateway",
					exportName: "loginKilo",
					module: "@oh-my-pi/pi-ai/registry/oauth/kilo",
					kind: "apiKey",
					login: loginKilo as never,
				},
				"Kilo Gateway",
			),
		xiaomi: () =>
			createOmpFlow(
				{
					name: "Xiaomi MiMo",
					exportName: "loginXiaomi",
					module: "@oh-my-pi/pi-ai/registry/oauth/xiaomi",
					kind: "apiKey",
					login: loginXiaomi as never,
				},
				"Xiaomi MiMo",
			),
		alibabaCodingPlan: () =>
			createOmpFlow(
				{
					name: "Alibaba Coding Plan",
					exportName: "loginAlibabaCodingPlan",
					module: "@oh-my-pi/pi-ai/registry/oauth/alibaba-coding-plan",
					kind: "apiKey",
					login: loginAlibabaCodingPlan as never,
				},
				"Alibaba Coding Plan",
			),
		alibabaTokenPlan: () =>
			createOmpFlow(
				{
					name: "QwenCloud Token Plan",
					exportName: "loginAlibabaTokenPlan",
					module: "@oh-my-pi/pi-ai/registry/oauth/alibaba-token-plan",
					kind: "apiKey",
					login: loginAlibabaTokenPlan as never,
				},
				"QwenCloud Token Plan",
			),
		perplexity: () =>
			createOmpFlow(
				{
					name: "Perplexity",
					exportName: "loginPerplexity",
					module: "@oh-my-pi/pi-ai/registry/oauth/perplexity",
					kind: "apiKey",
				},
				"Perplexity",
			),
		snowflake: () =>
			createOmpFlow(
				{
					name: "Snowflake",
					exportName: "loginSnowflake",
					module: "@oh-my-pi/pi-ai/registry/oauth/snowflake",
					kind: "apiKey",
				},
				"Snowflake",
			),
		cloudflareWorkersAi: () =>
			createOmpFlow(
				{
					name: "Cloudflare Workers AI",
					exportName: "loginCloudflareWorkersAi",
					module: "@oh-my-pi/pi-ai/registry/oauth/cloudflare-workers-ai",
					kind: "apiKey",
					login: loginCloudflareWorkersAi as never,
				},
				"Cloudflare Workers AI",
			),
		cloudflareAiGateway: () =>
			createOmpFlow(
				{
					name: "Cloudflare AI Gateway",
					exportName: "loginCloudflareAiGateway",
					module: "@oh-my-pi/pi-ai/registry/oauth/cloudflare-ai-gateway",
					kind: "apiKey",
					login: loginCloudflareAiGateway as never,
				},
				"Cloudflare AI Gateway",
			),
		mistralVibe: () =>
			createOmpFlow(
				{
					name: "Mistral",
					exportName: "loginMistralVibeSignIn",
					module: "@oh-my-pi/pi-ai/registry/oauth/mistral-vibe",
					kind: "apiKey",
					login: loginMistralVibeSignIn as never,
				},
				"Mistral",
			),
		cursor: () =>
			createOmpFlow(
				{
					name: "Cursor",
					exportName: "loginCursor",
					module: "@oh-my-pi/pi-ai/registry/oauth/cursor",
					kind: "apiKey",
				},
				"Cursor",
			),
		googleGeminiCli: () => googleGeminiCliOAuth,
		googleAntigravity: () => googleAntigravityOAuth,
		radius: createRadiusOAuth,
	});
}

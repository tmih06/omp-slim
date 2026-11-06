import type { OAuthAuth } from "../types.ts";
import { createOmpFlow } from "./omp-flow.ts";

/**
 * Loads an OAuth flow module through a variable specifier so bundlers cannot
 * follow the import into Node-only flow code (`node:http` callback servers,
 * `node:crypto` PKCE). The `.ts`/`.js` rewrite keeps the trick working from
 * both source and built output. The specifier is resolved against this
 * module's URL, not left relative: a bundler inlining this file (Chord's
 * worker base) keeps the variable import, which would otherwise resolve
 * against the bundle's location.
 */
const importOAuthModule = (specifier: string): Promise<unknown> => {
	const runtimeSpecifier = import.meta.url.endsWith(".js") ? specifier.replace(/\.ts$/, ".js") : specifier;
	return import(new URL(runtimeSpecifier, import.meta.url).href);
};

type OAuthFlowLoaders = {
	anthropic: () => OAuthAuth | Promise<OAuthAuth>;
	openaiCodex: () => OAuthAuth | Promise<OAuthAuth>;
	openaiChatGPT: () => OAuthAuth | Promise<OAuthAuth>;
	githubCopilot: () => OAuthAuth | Promise<OAuthAuth>;
	openrouter: () => OAuthAuth | Promise<OAuthAuth>;
	kimiCoding: () => OAuthAuth | Promise<OAuthAuth>;
	meta: () => OAuthAuth | Promise<OAuthAuth>;
	xai: () => OAuthAuth | Promise<OAuthAuth>;
	radius: (options: { name: string; gateway: string }) => OAuthAuth | Promise<OAuthAuth>;
	zai: () => OAuthAuth | Promise<OAuthAuth>;
	kilo: () => OAuthAuth | Promise<OAuthAuth>;
	xiaomi: () => OAuthAuth | Promise<OAuthAuth>;
	alibabaCodingPlan: () => OAuthAuth | Promise<OAuthAuth>;
	alibabaTokenPlan: () => OAuthAuth | Promise<OAuthAuth>;
	perplexity: () => OAuthAuth | Promise<OAuthAuth>;
	snowflake: () => OAuthAuth | Promise<OAuthAuth>;
	cloudflareWorkersAi: () => OAuthAuth | Promise<OAuthAuth>;
	cloudflareAiGateway: () => OAuthAuth | Promise<OAuthAuth>;
	mistralVibe: () => OAuthAuth | Promise<OAuthAuth>;
	cursor: () => OAuthAuth | Promise<OAuthAuth>;

	googleGeminiCli: () => OAuthAuth | Promise<OAuthAuth>;
	googleAntigravity: () => OAuthAuth | Promise<OAuthAuth>;
};

let bundledLoaders: OAuthFlowLoaders | undefined;

/** Registers statically bundled OAuth flows for standalone Bun binaries. */
export function registerBundledOAuthFlowLoaders(loaders: OAuthFlowLoaders): void {
	bundledLoaders = loaders;
}

export const loadKiloOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.kilo();
	return createOmpFlow(
		{ name: "Kilo Gateway", exportName: "loginKilo", module: "@oh-my-pi/pi-ai/registry/oauth/kilo", kind: "apiKey" },
		"Kilo Gateway",
	);
};

export const loadXiaomiOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.xiaomi();
	return createOmpFlow(
		{
			name: "Xiaomi MiMo",
			exportName: "loginXiaomi",
			module: "@oh-my-pi/pi-ai/registry/oauth/xiaomi",
			kind: "apiKey",
		},
		"Xiaomi MiMo",
	);
};

export const loadAlibabaCodingPlanOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.alibabaCodingPlan();
	return createOmpFlow(
		{
			name: "Alibaba Coding Plan",
			exportName: "loginAlibabaCodingPlan",
			module: "@oh-my-pi/pi-ai/registry/oauth/alibaba-coding-plan",
			kind: "apiKey",
		},
		"Alibaba Coding Plan",
	);
};

export const loadAlibabaTokenPlanOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.alibabaTokenPlan();
	return createOmpFlow(
		{
			name: "QwenCloud Token Plan",
			exportName: "loginAlibabaTokenPlan",
			module: "@oh-my-pi/pi-ai/registry/oauth/alibaba-token-plan",
			kind: "apiKey",
		},
		"QwenCloud Token Plan",
	);
};

export const loadPerplexityOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.perplexity();
	return createOmpFlow(
		{
			name: "Perplexity",
			exportName: "loginPerplexity",
			module: "@oh-my-pi/pi-ai/registry/oauth/perplexity",
			kind: "apiKey",
		},
		"Perplexity",
	);
};

export const loadSnowflakeOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.snowflake();
	return createOmpFlow(
		{
			name: "Snowflake",
			exportName: "loginSnowflake",
			module: "@oh-my-pi/pi-ai/registry/oauth/snowflake",
			kind: "apiKey",
		},
		"Snowflake",
	);
};

export const loadCloudflareWorkersAiOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.cloudflareWorkersAi();
	return createOmpFlow(
		{
			name: "Cloudflare Workers AI",
			exportName: "loginCloudflareWorkersAi",
			module: "@oh-my-pi/pi-ai/registry/oauth/cloudflare-workers-ai",
			kind: "apiKey",
		},
		"Cloudflare Workers AI",
	);
};

export const loadCloudflareAiGatewayOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.cloudflareAiGateway();
	return createOmpFlow(
		{
			name: "Cloudflare AI Gateway",
			exportName: "loginCloudflareAiGateway",
			module: "@oh-my-pi/pi-ai/registry/oauth/cloudflare-ai-gateway",
			kind: "apiKey",
		},
		"Cloudflare AI Gateway",
	);
};

export const loadMistralVibeOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.mistralVibe();
	return createOmpFlow(
		{
			name: "Mistral",
			exportName: "loginMistralVibeSignIn",
			module: "@oh-my-pi/pi-ai/registry/oauth/mistral-vibe",
			kind: "apiKey",
		},
		"Mistral",
	);
};

export const loadCursorOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.cursor();
	return createOmpFlow(
		{ name: "Cursor", exportName: "loginCursor", module: "@oh-my-pi/pi-ai/registry/oauth/cursor", kind: "apiKey" },
		"Cursor",
	);
};

export const loadGoogleGeminiCliOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.googleGeminiCli();
	return ((await importOAuthModule("./google-cloud-code.ts")) as { googleGeminiCliOAuth: OAuthAuth })
		.googleGeminiCliOAuth;
};

export const loadGoogleAntigravityOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.googleAntigravity();
	return ((await importOAuthModule("./google-cloud-code.ts")) as { googleAntigravityOAuth: OAuthAuth })
		.googleAntigravityOAuth;
};

export const loadZaiOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.zai();
	return ((await importOAuthModule("./zai.ts")) as { zaiOAuth: OAuthAuth }).zaiOAuth;
};

export const loadAnthropicOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.anthropic();
	return ((await importOAuthModule("./anthropic.ts")) as { anthropicOAuth: OAuthAuth }).anthropicOAuth;
};

export const loadOpenAICodexOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.openaiCodex();
	return ((await importOAuthModule("./openai-codex.ts")) as { openaiCodexOAuth: OAuthAuth }).openaiCodexOAuth;
};

export const loadOpenAIChatGPTOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.openaiChatGPT();
	return ((await importOAuthModule("./openai-chatgpt.ts")) as { openaiChatGPTOAuth: OAuthAuth }).openaiChatGPTOAuth;
};

export const loadGitHubCopilotOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.githubCopilot();
	return ((await importOAuthModule("./github-copilot.ts")) as { githubCopilotOAuth: OAuthAuth }).githubCopilotOAuth;
};

export const loadOpenRouterOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.openrouter();
	return ((await importOAuthModule("./openrouter.ts")) as { openRouterOAuth: OAuthAuth }).openRouterOAuth;
};

export const loadKimiCodingOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.kimiCoding();
	return ((await importOAuthModule("./kimi-coding.ts")) as { kimiCodingOAuth: OAuthAuth }).kimiCodingOAuth;
};

export const loadMetaOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.meta();
	return ((await importOAuthModule("./meta.ts")) as { metaOAuth: OAuthAuth }).metaOAuth;
};

export const loadXaiOAuth = async (): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.xai();
	return ((await importOAuthModule("./xai.ts")) as { xaiOAuth: OAuthAuth }).xaiOAuth;
};

export const loadRadiusOAuth = async (options: { name: string; gateway: string }): Promise<OAuthAuth> => {
	if (bundledLoaders) return bundledLoaders.radius(options);
	return (
		(await importOAuthModule("./radius.ts")) as {
			createRadiusOAuth: (input: { name: string; gateway: string }) => OAuthAuth;
		}
	).createRadiusOAuth(options);
};

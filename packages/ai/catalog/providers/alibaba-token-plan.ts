import { defineProvider, modelsDevModels } from "../define.ts";

// Models, limits, and prices come from the models.dev catalog; only the endpoint is local.
export default defineProvider({
	id: "alibaba-token-plan",
	models: (ctx) =>
		modelsDevModels(ctx, "alibaba-token-plan", {
			api: "openai-completions",
			baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
			skipDeprecated: true,
		}),
	compat: {
		"openai-completions": {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			supportsStrictMode: false,
			supportsLongCacheRetention: false,
		},
	},
});

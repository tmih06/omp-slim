import { defineProvider, modelsDevModels } from "../define.ts";

// Models, limits, and prices come from the models.dev catalog; only the endpoint is local.
export default defineProvider({
	id: "kilo",
	models: (ctx) =>
		modelsDevModels(ctx, "kilo", {
			api: "openai-completions",
			baseUrl: "https://api.kilo.ai/api/gateway",
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

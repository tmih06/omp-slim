import { defineProvider, modelsDevModels } from "../define.ts";

// Models, limits, and prices come from the models.dev catalog; only the endpoint is local.
export default defineProvider({
	id: "aimlapi",
	models: (ctx) =>
		modelsDevModels(ctx, "aimlapi", {
			api: "openai-completions",
			baseUrl: "https://api.aimlapi.com/v1",
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

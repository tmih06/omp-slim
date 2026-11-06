import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadAlibabaTokenPlanOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { ALIBABA_TOKEN_PLAN_MODELS } from "./alibaba-token-plan.models.ts";

export function alibabaTokenPlanProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "alibaba-token-plan",
		name: "Alibaba Token Plan",
		baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
		auth: {
			apiKey: envApiKeyAuth("Alibaba Token Plan API key", ["ALIBABA_TOKEN_PLAN_API_KEY"]),
			oauth: lazyOAuth({
				name: "QwenCloud Token Plan",
				isSubscription: true,
				loginLabel: "Sign in with QwenCloud",
				load: loadAlibabaTokenPlanOAuth,
			}),
		},
		models: Object.values(ALIBABA_TOKEN_PLAN_MODELS),
		api: openAICompletionsApi(),
	});
}

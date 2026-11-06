import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadAlibabaCodingPlanOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { ALIBABA_CODING_PLAN_MODELS } from "./alibaba-coding-plan.models.ts";

export function alibabaCodingPlanProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "alibaba-coding-plan",
		name: "Alibaba Coding Plan",
		baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
		auth: {
			apiKey: envApiKeyAuth("Alibaba Coding Plan API key", ["ALIBABA_CODING_PLAN_API_KEY"]),
			oauth: lazyOAuth({
				name: "Alibaba Coding Plan",
				isSubscription: true,
				loginLabel: "Sign in with Alibaba",
				load: loadAlibabaCodingPlanOAuth,
			}),
		},
		models: Object.values(ALIBABA_CODING_PLAN_MODELS),
		api: openAICompletionsApi(),
	});
}

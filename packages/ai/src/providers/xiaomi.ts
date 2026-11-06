import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadXiaomiOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { XIAOMI_MODELS } from "./xiaomi.models.ts";

export function xiaomiProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "xiaomi",
		name: "Xiaomi",
		baseUrl: "https://api.xiaomimimo.com/v1",
		auth: {
			apiKey: envApiKeyAuth("Xiaomi API key", ["XIAOMI_API_KEY"]),
			oauth: lazyOAuth({
				name: "Xiaomi MiMo",
				isSubscription: true,
				loginLabel: "Sign in with Xiaomi",
				load: loadXiaomiOAuth,
			}),
		},
		models: Object.values(XIAOMI_MODELS),
		api: openAICompletionsApi(),
	});
}

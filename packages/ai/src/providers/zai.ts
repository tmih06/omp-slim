import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadZaiOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { ZAI_MODELS } from "./zai.models.ts";

export function zaiProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "zai",
		name: "Z.AI",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		auth: {
			apiKey: envApiKeyAuth("Z.AI API key", ["ZAI_API_KEY"]),
			// Subscription sign-in mints a durable API key, so the request path is unchanged.
			oauth: lazyOAuth({
				name: "Z.AI (GLM Coding Plan · Sign in)",
				isSubscription: true,
				loginLabel: "Sign in with Z.AI",
				load: loadZaiOAuth,
			}),
		},
		models: Object.values(ZAI_MODELS),
		api: openAICompletionsApi(),
	});
}

import { mistralConversationsApi } from "../api/mistral-conversations.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadMistralVibeOAuth } from "../auth/oauth/load.ts";
import { createProvider, type Provider } from "../models.ts";
import { MISTRAL_MODELS } from "./mistral.models.ts";

export function mistralProvider(): Provider<"mistral-conversations"> {
	return createProvider({
		id: "mistral",
		name: "Mistral",
		baseUrl: "https://api.mistral.ai",
		auth: {
			apiKey: envApiKeyAuth("Mistral API key", ["MISTRAL_API_KEY"]),
			oauth: lazyOAuth({
				name: "Mistral",
				isSubscription: true,
				loginLabel: "Sign in with Mistral",
				load: loadMistralVibeOAuth,
			}),
		},
		models: Object.values(MISTRAL_MODELS),
		api: mistralConversationsApi(),
	});
}

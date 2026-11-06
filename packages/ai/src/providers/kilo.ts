import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { KILO_MODELS } from "./kilo.models.ts";

export function kiloProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "kilo",
		name: "Kilo Gateway",
		baseUrl: "https://api.kilo.ai/api/gateway",
		auth: { apiKey: envApiKeyAuth("Kilo Gateway API key", ["KILO_API_KEY"]) },
		models: Object.values(KILO_MODELS),
		api: openAICompletionsApi(),
	});
}

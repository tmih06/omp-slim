import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { MODULAR_MODELS } from "./modular.models.ts";

export function modularProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "modular",
		name: "Modular",
		baseUrl: "https://api.modular.com/v1",
		auth: { apiKey: envApiKeyAuth("Modular API key", ["MODULAR_API_KEY"]) },
		models: Object.values(MODULAR_MODELS),
		api: openAICompletionsApi(),
	});
}

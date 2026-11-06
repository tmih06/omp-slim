import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { SAMBANOVA_MODELS } from "./sambanova.models.ts";

export function sambanovaProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "sambanova",
		name: "SambaNova",
		baseUrl: "https://api.sambanova.ai/v1",
		auth: { apiKey: envApiKeyAuth("SambaNova API key", ["SAMBANOVA_API_KEY"]) },
		models: Object.values(SAMBANOVA_MODELS),
		api: openAICompletionsApi(),
	});
}

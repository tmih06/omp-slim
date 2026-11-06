import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { AIAND_MODELS } from "./aiand.models.ts";

export function aiandProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "aiand",
		name: "ai&",
		baseUrl: "https://api.aiand.com/v1",
		auth: { apiKey: envApiKeyAuth("ai& API key", ["AIAND_API_KEY"]) },
		models: Object.values(AIAND_MODELS),
		api: openAICompletionsApi(),
	});
}

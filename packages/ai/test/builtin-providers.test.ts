import { describe, expect, it } from "vitest";
import { findEnvKeys } from "../src/env-api-keys.ts";
import { getBuiltinModels, getBuiltinProviders } from "../src/providers/all.ts";

/**
 * Providers ported from OMP. Each is a models.dev catalog served on one OpenAI-compatible endpoint,
 * so a missing registration or a missing env mapping silently removes it from `/model` rather than
 * failing loudly.
 */
const PORTED: Array<[id: string, envVar: string, baseUrlFragment: string]> = [
	["aiand", "AIAND_API_KEY", "api.aiand.com"],
	["aimlapi", "AIMLAPI_API_KEY", "api.aimlapi.com"],
	["alibaba-coding-plan", "ALIBABA_CODING_PLAN_API_KEY", "dashscope.aliyuncs.com"],
	["alibaba-token-plan", "ALIBABA_TOKEN_PLAN_API_KEY", "aliyuncs.com"],
	["cline-pass", "CLINE_API_KEY", "api.cline.bot"],
	["commandcode", "CMD_API_KEY", "api.commandcode.ai"],
	["coralbricks", "CORAL_API_KEY", "coralbricks.ai"],
	["deepinfra", "DEEPINFRA_API_KEY", "api.deepinfra.com"],
	["inception", "INCEPTION_API_KEY", "api.inceptionlabs.ai"],
	["kilo", "KILO_API_KEY", "api.kilo.ai"],
	["modular", "MODULAR_API_KEY", "api.modular.com"],
	["ollama-cloud", "OLLAMA_API_KEY", "ollama.com"],
	["sambanova", "SAMBANOVA_API_KEY", "api.sambanova.ai"],
	["scaleway", "SCALEWAY_API_KEY", "api.scaleway.ai"],
	["synthetic", "SYNTHETIC_API_KEY", "api.synthetic.new"],
	["venice", "VENICE_API_KEY", "api.venice.ai"],
];

describe("ported providers", () => {
	it("are registered with models and a reachable endpoint", () => {
		const registered = new Set(getBuiltinProviders());
		const problems: string[] = [];
		for (const [id, , baseUrlFragment] of PORTED) {
			if (!registered.has(id as never)) {
				problems.push(`${id}: not registered`);
				continue;
			}
			const models = getBuiltinModels(id as never);
			if (models.length === 0) {
				problems.push(`${id}: no models`);
				continue;
			}
			// A wrong endpoint is invisible until the first request, so check it here.
			if (!models[0].baseUrl.includes(baseUrlFragment)) {
				problems.push(`${id}: endpoint ${models[0].baseUrl} does not contain ${baseUrlFragment}`);
			}
		}
		expect(problems).toEqual([]);
	});

	it("resolve credentials from their documented environment variable", () => {
		// `findEnvKeys` reports only variables that are set, so each is provided here: that is the
		// path a user with a key takes, and the assertion fails if the mapping is missing or wrong.
		const problems: string[] = [];
		for (const [id, envVar] of PORTED) {
			const keys = findEnvKeys(id, { [envVar]: "test-key" });
			if (!keys?.includes(envVar)) problems.push(`${id}: expected ${envVar}, got ${JSON.stringify(keys)}`);
		}
		expect(problems).toEqual([]);
	});

	it("keeps the providers that were already present", () => {
		// Guard against a registration edit silently dropping existing coverage.
		const registered = new Set(getBuiltinProviders());
		for (const id of ["anthropic", "openai", "google", "deepseek", "together", "openrouter"]) {
			expect(registered.has(id as never), id).toBe(true);
		}
		expect(getBuiltinModels("anthropic" as never).length).toBeGreaterThan(0);
	});
});

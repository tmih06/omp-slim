import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	APP_NAME,
	CONFIG_DIR_NAME,
	ENV_AGENT_DIR,
	ENV_SESSION_DIR,
	getAgentDir,
	getAuthPath,
	getSessionsDir,
	getSettingsPath,
} from "../src/config.ts";

interface CodingAgentPackageJson {
	bin: Record<string, string>;
	main: string;
	exports: {
		".": { import: string; types: string };
		"./rpc-entry": { import: string };
	};
}

const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as CodingAgentPackageJson;

describe("package distribution entrypoints", () => {
	afterEach(() => vi.unstubAllEnvs());

	test("shares Pi's default user settings, credentials, and sessions", () => {
		vi.stubEnv(ENV_AGENT_DIR, undefined);
		const agentDir = join(homedir(), ".pi", "agent");
		expect(getAgentDir()).toBe(agentDir);
		expect(getSettingsPath()).toBe(join(agentDir, "settings.json"));
		expect(getAuthPath()).toBe(join(agentDir, "auth.json"));
		expect(getSessionsDir()).toBe(join(agentDir, "sessions"));
	});

	test("uses the fork name and normalized environment variables while sharing Pi configuration", () => {
		expect(APP_NAME).toBe("omp-slim");
		expect(CONFIG_DIR_NAME).toBe(".pi");
		expect(ENV_AGENT_DIR).toBe("OMP_SLIM_CODING_AGENT_DIR");
		expect(ENV_SESSION_DIR).toBe("OMP_SLIM_CODING_AGENT_SESSION_DIR");
	});

	test("uses the bundle for executables and modular output for libraries", () => {
		expect(packageJson.bin[APP_NAME]).toBe("dist/bundle/cli.js");
		expect(packageJson.main).toBe("./dist/index.js");
		expect(packageJson.exports["."].import).toBe("./dist/index.js");
		expect(packageJson.exports["./rpc-entry"].import).toBe("./dist/bundle/rpc-entry.js");
	});
});

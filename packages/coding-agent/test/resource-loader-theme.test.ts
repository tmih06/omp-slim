import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetCapabilitiesCache, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { loadThemeFromPath, setThemeInstance, setThemeJsonValidator } from "../src/modes/interactive/theme/theme.ts";
import { validateThemeJson } from "../src/modes/interactive/theme/theme-schema.ts";

setThemeJsonValidator(validateThemeJson);

interface TestThemeJson {
	name: string;
	colors: Record<string, string | number>;
	unsupported?: boolean;
}

describe("DefaultResourceLoader theme color mode", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;
	let themePath: string;
	let themeJson: TestThemeJson;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "resource-loader-theme-"));
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });

		themeJson = JSON.parse(
			readFileSync(join(process.cwd(), "src", "modes", "interactive", "theme", "dark.json"), "utf-8"),
		) as TestThemeJson;
		themeJson.name = "capability-test";
		themeJson.colors.userMessageBg = "#3c3544";
		themePath = join(tempDir, "capability-test.json");
		writeFileSync(themePath, JSON.stringify(themeJson));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		setCapabilityOverrides({});
		resetCapabilitiesCache();
		rmSync(tempDir, { recursive: true, force: true });
	});

	// Regression test for #9973.
	it.each([
		{
			environment: "256-color",
			environmentOverride: "0",
			setting: true,
			expected: "\x1b[48;2;60;53;68mx\x1b[49m",
		},
		{
			environment: "truecolor",
			environmentOverride: "1",
			setting: false,
			expected: "\x1b[48;5;59mx\x1b[49m",
		},
	])(
		"uses the $setting setting over a $environment environment",
		async ({ environmentOverride, setting, expected }) => {
			vi.stubEnv("PI_TRUE_COLOR", environmentOverride);
			setCapabilityOverrides({});
			resetCapabilitiesCache();

			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: SettingsManager.inMemory({ terminal: { trueColor: setting } }),
				additionalThemePaths: [themePath],
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noContextFiles: true,
			});
			await loader.reload();

			const loadedTheme = loader.getThemes().themes.find((theme) => theme.name === "capability-test");
			expect(loadedTheme?.bg("userMessageBg", "x")).toBe(expected);
		},
	);

	it("returns to automatic detection after an explicit setting is removed", async () => {
		vi.stubEnv("PI_TRUE_COLOR", "1");
		setCapabilityOverrides({});
		resetCapabilitiesCache();

		const settingsPath = join(agentDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ terminal: { trueColor: false } }));
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			additionalThemePaths: [themePath],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
		});
		await loader.reload();
		setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());

		writeFileSync(settingsPath, "{}");
		await loader.reload();

		const loadedTheme = loader.getThemes().themes.find((theme) => theme.name === "capability-test");
		expect(loadedTheme?.bg("userMessageBg", "x")).toBe("\x1b[48;2;60;53;68mx\x1b[49m");
	});

	it("applies strict validation on initial load and reload", async () => {
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			additionalThemePaths: [themePath],
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
		});

		themeJson.unsupported = true;
		writeFileSync(themePath, JSON.stringify(themeJson));
		await loader.reload();
		const initialDiagnostics = loader.getThemes().diagnostics;
		expect(initialDiagnostics).toHaveLength(1);
		expect(initialDiagnostics[0]).toMatchObject({ type: "warning", path: themePath });
		expect(initialDiagnostics[0]?.message).toContain("/unsupported");

		delete themeJson.unsupported;
		writeFileSync(themePath, JSON.stringify(themeJson));
		await loader.reload();
		expect(loader.getThemes().diagnostics).toEqual([]);
		expect(loader.getThemes().themes.some((theme) => theme.name === themeJson.name)).toBe(true);

		themeJson.unsupported = true;
		writeFileSync(themePath, JSON.stringify(themeJson));
		await loader.reload();
		expect(loader.getThemes().diagnostics).toEqual(initialDiagnostics);
	});
});

describe("themes shared with OMP", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	/**
	 * OMP defines color tokens this engine does not render (`statusLine*`, `pythonMode`) and writes them
	 * into the same `~/.pi/agent/themes` directory. Rejecting unknown keys made every OMP theme
	 * unusable here and told the user to strip tokens OMP still needs.
	 */
	function writeSharedTheme(colors: Record<string, string>): string {
		const dir = mkdtempSync(join(tmpdir(), "omp-theme-"));
		tempDirs.push(dir);
		const themePath = join(dir, "shared.json");
		writeFileSync(themePath, JSON.stringify({ name: "shared", colors }));
		return themePath;
	}

	function minimalColors(): Record<string, string> {
		// Start from a built-in theme so the required token set is whatever this engine requires.
		const builtin = JSON.parse(
			readFileSync(join(import.meta.dirname, "..", "src", "modes", "interactive", "theme", "dark.json"), "utf8"),
		) as { colors: Record<string, string>; vars?: Record<string, string> };
		// Resolve the built-in's variable references so the test theme is self-contained.
		const resolved: Record<string, string> = {};
		for (const [key, value] of Object.entries(builtin.colors)) {
			resolved[key] = builtin.vars?.[value] ?? value;
		}
		return resolved;
	}

	it("accepts color tokens this engine does not render", () => {
		const colors = minimalColors();
		expect(() => validateThemeJson("shared", { name: "shared", colors })).not.toThrow();

		// OMP-only tokens ride along without complaint.
		expect(() =>
			validateThemeJson("shared", {
				name: "shared",
				colors: { ...colors, statusLineBg: "#101010", pythonMode: "#00ff00" },
			}),
		).not.toThrow();
	});

	it("still rejects an unknown token that is not a color", () => {
		// Tolerating extra keys must not turn into "any value passes".
		expect(() =>
			validateThemeJson("shared", { name: "shared", colors: { ...minimalColors(), broken: { nested: true } } }),
		).toThrow();
	});

	it("renders a theme that carries foreign tokens", () => {
		// Validation alone is not enough: the loader splits colors into fg/bg by looking up each key's
		// descriptor, so an unknown key must be skipped there too or it throws at render time.
		const theme = loadThemeFromPath(
			writeSharedTheme({ ...minimalColors(), statusLineBg: "#101010", pythonMode: "#00ff00" }),
		);
		expect(theme.name).toBe("shared");
		setThemeInstance(theme);
		expect(theme.fg("accent", "x")).toContain("x");
		expect(theme.bg("userMessageBg", "x")).toContain("x");
	});

	it("still requires the tokens this engine renders", () => {
		expect(() => validateThemeJson("shared", { name: "shared", colors: { statusLineBg: "#101010" } })).toThrow(
			/Missing required color tokens/u,
		);
	});
});

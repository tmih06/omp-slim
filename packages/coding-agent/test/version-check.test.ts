import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewPiVersion,
	comparePackageVersions,
	formatVersionCheckError,
	getLatestPiRelease,
	getLatestPiVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";
import { allowNetwork } from "./test-network-env.ts";

const originalSkipVersionCheck = process.env.PI_SKIP_VERSION_CHECK;

beforeEach(() => {
	allowNetwork();
});

afterEach(() => {
	vi.unstubAllGlobals();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.PI_SKIP_VERSION_CHECK;
	} else {
		process.env.PI_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("returns only newer versions", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v1.2.3" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewPiVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" });
	});

	it("reads the newest release of the fork with a pi user agent", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ tag_name: "v1.2.4", html_url: "https://github.com/tmih06/omp-slim/releases/tag/v1.2.4" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.github.com/repos/tmih06/omp-slim/releases/latest",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^pi\/1\.2\.3 /),
					accept: "application/vnd.github+json",
				}),
			}),
		);
	});

	it("strips the v prefix from release tags", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v2.0.0" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("0.1.0")).resolves.toEqual({ version: "2.0.0" });
	});

	it("treats a repository without releases as having nothing to update to", async () => {
		const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("0.1.0")).resolves.toBeUndefined();
		await expect(checkForNewPiVersion("0.1.0")).resolves.toBeUndefined();
	});

	it("does not treat an upstream version as a fork release", async () => {
		// Upstream pi ships 1.5.0; the fork is at 0.1.0. Only fork tags may trigger a notification.
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v1.5.0" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPiVersion("0.1.0")).resolves.toEqual({ version: "1.5.0" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.github.com/repos/tmih06/omp-slim/releases/latest",
			expect.anything(),
		);
	});

	it("retries a transient version request when explicitly requested", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockResolvedValueOnce(Response.json({ tag_name: "v1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("1.2.3", { retry: true })).resolves.toEqual({ version: "1.2.4" });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("keeps automatic version checks to one request", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("formats nested network error details", () => {
		const error = new Error("fetch failed", {
			cause: new AggregateError([
				Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }),
				Object.assign(new Error("network unreachable"), { code: "ENETUNREACH" }),
			]),
		});

		expect(formatVersionCheckError(error)).toBe("fetch failed (ETIMEDOUT, ENETUNREACH)");
	});

	it("returns the release page and notes body", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				tag_name: "v1.2.4",
				body: " **Read this** ",
				html_url: "https://github.com/tmih06/omp-slim/releases/tag/v1.2.4",
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("1.2.3")).resolves.toEqual({
			version: "1.2.4",
			note: "**Read this**",
			htmlUrl: "https://github.com/tmih06/omp-slim/releases/tag/v1.2.4",
		});
	});

	it("ignores tags that are not versions", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "nightly" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiRelease("0.1.0")).resolves.toBeUndefined();
	});

	it("skips automatic api calls when version checks are disabled", async () => {
		process.env.PI_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewPiVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("allows direct api calls when automatic version checks are disabled", async () => {
		process.env.PI_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestPiVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});

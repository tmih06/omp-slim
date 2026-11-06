import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { isAccountQuotaExhausted, isRetryableAssistantError } from "../src/utils/retry.ts";

function failed(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "test",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: 0,
	} as AssistantMessage;
}

describe("isAccountQuotaExhausted", () => {
	it("recognizes quota and billing exhaustion", () => {
		for (const message of [
			"insufficient_quota: You exceeded your current quota",
			"Out of budget for this billing period",
			"quota exceeded",
			"Monthly usage limit reached",
			"FreeUsageLimitError",
			"GoUsageLimitError",
			"subscription_sharing_usage_limit_exceeded",
			"subscription_sharing_workplace_individual_usage_limit_exceeded",
			'{"code": 1308, "message": "usage limit"}',
			"Please check your plan and billing details",
		]) {
			expect(isAccountQuotaExhausted(failed(message)), message).toBe(true);
		}
	});

	it("does not treat transient throttling as exhaustion", () => {
		// A sibling account would not help here; existing backoff handles these.
		for (const message of [
			"429 Too Many Requests",
			"rate limit exceeded",
			"overloaded_error",
			"server_busy",
			"fetch failed",
			"socket hang up",
			"timeout",
		]) {
			expect(isAccountQuotaExhausted(failed(message)), message).toBe(false);
		}
	});

	it("ignores responses that did not fail", () => {
		expect(isAccountQuotaExhausted({ ...failed("quota exceeded"), stopReason: "stop" })).toBe(false);
		expect(isAccountQuotaExhausted({ ...failed(""), errorMessage: undefined })).toBe(false);
	});

	it("is the complement of retryability for quota errors", () => {
		// The pair is what makes rotation necessary: waiting cannot fix exhaustion, so the plain retry
		// path refuses it and the run would otherwise fail with quota left on another account.
		const quota = failed("insufficient_quota");
		expect(isAccountQuotaExhausted(quota)).toBe(true);
		expect(isRetryableAssistantError(quota)).toBe(false);

		const throttle = failed("429 Too Many Requests");
		expect(isAccountQuotaExhausted(throttle)).toBe(false);
		expect(isRetryableAssistantError(throttle)).toBe(true);
	});
});

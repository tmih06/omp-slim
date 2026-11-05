import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { formatThroughput } from "../src/core/throughput.ts";

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function assistant(usage: {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: "test",
		model: "test-model",
		usage: { ...usage, cost: zeroCost },
		stopReason: "stop",
		timestamp: 0,
	} as AssistantMessage;
}

describe("formatThroughput", () => {
	it("prints the rate over the generated tokens and the run's token totals", () => {
		const messages = [assistant({ input: 210, output: 76, cacheRead: 192_256, cacheWrite: 0, totalTokens: 192_542 })];

		expect(formatThroughput(messages, 5900)).toBe(
			"TPS 12.9 tok/s. out 76, in 210, cache r/w 192,256/0, total 192,542, 5.9s",
		);
	});

	it("sums the assistant messages of a run and ignores other roles", () => {
		const user: UserMessage = { role: "user", content: "hi", timestamp: 0 };
		const messages = [
			user,
			assistant({ input: 100, output: 50, cacheRead: 1000, cacheWrite: 10, totalTokens: 1160 }),
			assistant({ input: 50, output: 50, cacheRead: 500, cacheWrite: 0, totalTokens: 600 }),
		];

		expect(formatThroughput(messages, 2000)).toBe(
			"TPS 50.0 tok/s. out 100, in 150, cache r/w 1,500/10, total 1,760, 2.0s",
		);
	});

	it("reports nothing when the run generated no tokens", () => {
		const messages = [assistant({ input: 100, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 100 })];

		expect(formatThroughput(messages, 1000)).toBeUndefined();
	});

	it("reports nothing for a run with no measurable elapsed time", () => {
		const messages = [assistant({ input: 0, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 10 })];

		expect(formatThroughput(messages, 0)).toBeUndefined();
	});
});

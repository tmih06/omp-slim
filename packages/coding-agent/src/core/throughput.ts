import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Throughput summary shown after a run in interactive mode, for example:
 *
 *   TPS 12.9 tok/s. out 76, in 210, cache r/w 192,256/0, total 192,542, 5.9s
 *
 * `out` is the generated tokens, so it is the numerator of the rate. `in`, `cache r/w`, and `total`
 * are sums over the run's assistant messages. Time is measured from `agent_start`, so it includes
 * tool execution and provider waiting.
 */
export function formatThroughput(messages: readonly AgentMessage[], elapsedMs: number): string | undefined {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalTokens = 0;

	for (const message of messages) {
		if (message.role !== "assistant") continue;
		input += message.usage.input;
		output += message.usage.output;
		cacheRead += message.usage.cacheRead;
		cacheWrite += message.usage.cacheWrite;
		totalTokens += message.usage.totalTokens;
	}

	const elapsedSeconds = elapsedMs / 1000;
	if (output <= 0 || elapsedSeconds <= 0) return undefined;

	const tokensPerSecond = output / elapsedSeconds;
	return `TPS ${tokensPerSecond.toFixed(1)} tok/s. out ${output.toLocaleString()}, in ${input.toLocaleString()}, cache r/w ${cacheRead.toLocaleString()}/${cacheWrite.toLocaleString()}, total ${totalTokens.toLocaleString()}, ${elapsedSeconds.toFixed(1)}s`;
}

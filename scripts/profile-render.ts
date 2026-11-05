#!/usr/bin/env node
/**
 * Reproduces the numbers in docs/performance-investigation.md.
 *
 *   node --experimental-strip-types scripts/profile-render.ts
 *
 * Measures the TUI text primitives that run on every redraw. The `truncateToWidth` cases are the
 * ones that motivated the fits fast path in packages/tui/src/utils.ts: a styled line that already
 * fits used to pay the full grapheme walk.
 */

import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "../packages/tui/src/utils.ts";

const STYLED = "\x1b[38;2;120;180;255mfunction\x1b[0m \x1b[1mfoo\x1b[0m(bar: \x1b[33mstring\x1b[0m): number { return 42; }";
const PLAIN = "function foo(bar: string): number { return 42; }";
const CJK = "这是一行中文注释内容，用于测试宽度计算。";

function bench(label: string, fn: () => void, iterations: number): number {
	for (let i = 0; i < Math.max(1, iterations / 10); i++) fn();
	const start = performance.now();
	for (let i = 0; i < iterations; i++) fn();
	const micros = ((performance.now() - start) * 1000) / iterations;
	console.log(`${label.padEnd(38)} ${micros.toFixed(2).padStart(8)} us/op`);
	return micros;
}

console.log(`styled line: ${STYLED.length} chars, plain line: ${PLAIN.length} chars\n`);

bench("visibleWidth styled", () => visibleWidth(STYLED), 200_000);
bench("visibleWidth plain", () => visibleWidth(PLAIN), 200_000);
bench("visibleWidth cjk", () => visibleWidth(CJK), 100_000);
console.log();
bench("truncateToWidth styled, fits", () => truncateToWidth(STYLED, 400), 200_000);
bench("truncateToWidth styled, exact fit", () => truncateToWidth(STYLED, visibleWidth(STYLED)), 200_000);
bench("truncateToWidth styled, needs cut", () => truncateToWidth(STYLED, 30), 20_000);
bench("truncateToWidth plain, needs cut", () => truncateToWidth(PLAIN, 20), 20_000);
console.log();

const frame = Array.from({ length: 50 }, (_, i) => `${STYLED} ${i}`).join("\n");
const lines = frame.split("\n");
bench("visibleWidth over 50-line frame", () => {
	for (const line of lines) visibleWidth(line);
}, 5_000);
bench("wrapTextWithAnsi over 50-line frame", () => {
	for (const line of lines) wrapTextWithAnsi(line, 80);
}, 500);

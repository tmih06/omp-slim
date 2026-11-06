import { foregroundAnsi, isAppleTerminalSession, rgbColor } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const WHITE = rgbColor(236, 236, 236);
const CORAL = rgbColor(228, 138, 122);
const GREEN = rgbColor(126, 200, 120);
const RESET = "\x1b[0m";

/**
 * Glyph cell grid for the wordmark: three columns of four pixels per letter, rendered as two text
 * lines with half blocks. Each column holds the top four rows; line one draws rows 0-1, line two
 * rows 2-3.
 */
const GLYPHS: Record<string, string[]> = {
	O: ["███", "█ █", "█ █", "███"],
	// Five columns: the two peaks and the valley need the extra width to read as M rather than H.
	M: ["█   █", "██ ██", "█ █ █", "█   █"],
	P: ["███", "█ █", "███", "█  "],
	S: ["███", "█  ", " ██", "███"],
	L: ["█  ", "█  ", "█  ", "███"],
	I: ["███", " █ ", " █ ", "███"],
};

/** Column groups, in the order they appear, each drawn in its own color. */
const GROUPS: readonly { chars: readonly string[]; color: typeof WHITE }[] = [
	{ chars: ["O", "M"], color: WHITE },
	{ chars: ["P"], color: CORAL },
	{ chars: ["S", "L", "I", "M"], color: GREEN },
];

type Column = { group: number; pixels: readonly string[] };

/** Lay out the wordmark as columns, inserting a gap between groups and between letters. */
function buildColumns(): Column[] {
	const columns: Column[] = [];
	for (const [index, group] of GROUPS.entries()) {
		if (index > 0) columns.push({ group: -1, pixels: [" ", " ", " ", " "] });
		for (const character of group.chars) {
			const glyph = GLYPHS[character];
			for (let column = 0; column < glyph[0].length; column++) {
				columns.push({
					group: index,
					pixels: [glyph[0][column], glyph[1][column], glyph[2][column], glyph[3][column]],
				});
			}
			columns.push({ group: index, pixels: [" ", " ", " ", " "] });
		}
	}
	return columns;
}

/** Half-block character for one column: top pixel filled, bottom filled, both, or neither. */
function cell(column: Column, topRow: number): string {
	const top = column.pixels[topRow] === "█";
	const bottom = column.pixels[topRow + 1] === "█";
	if (top && bottom) return "█";
	if (top) return "▀";
	if (bottom) return "▄";
	return " ";
}

/**
 * The omp-slim block wordmark, two lines tall: `OM` in white, `P` in the accent coral, `SLIM` in
 * green. Rendered at 34 cells wide, which fits the default 80-column terminal alongside the version.
 *
 * Colors are fixed rather than theme-derived so the mark reads the same in every theme, matching how
 * the previous block logo behaved.
 */
export function piLogoLines(): [string, string] {
	const mode = theme.getColorMode();
	const columns = buildColumns();

	const render = (topRow: number): string => {
		let line = "";
		let currentGroup = -2;
		for (const column of columns) {
			// Emit a color change only when the group changes, so blank spacer columns inherit the
			// previous color instead of emitting resets that leave gaps.
			if (column.group >= 0 && column.group !== currentGroup) {
				const color = GROUPS[column.group]!.color;
				line += foregroundAnsi(color, mode);
				currentGroup = column.group;
			}
			line += cell(column, topRow);
		}
		return line + RESET;
	};

	return [render(0), render(2)];
}

/**
 * Whether the terminal renders half blocks cleanly. Apple Terminal leaves gaps between rows and
 * misaligns them, so it gets the plain wordmark instead.
 */
export function supportsPiLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo, using the same three color groups as the block mark. */
export function piWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(WHITE, mode)}OM${RESET}${foregroundAnsi(CORAL, mode)}P${RESET}${foregroundAnsi(GREEN, mode)}-SLIM${RESET}`;
}

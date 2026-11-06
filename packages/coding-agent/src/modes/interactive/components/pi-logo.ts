import { backgroundAnsi, foregroundAnsi, isAppleTerminalSession, rgbColor } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const WHITE = rgbColor(236, 236, 236);
const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const LIGHT_PURPLE = rgbColor(198, 160, 246);
const RESET = "\x1b[0m";

/**
 * Half-block glyphs for the fork's prefix, four pixel rows tall. Line one draws pixel rows 0-1 and
 * line two draws rows 2-3.
 */
const GLYPHS: Record<string, readonly string[]> = {
	O: ["███", "█ █", "█ █", "███"],
	// Five columns: at this height a three-column M is indistinguishable from H.
	M: ["█   █", "██ ██", "█ █ █", "█   █"],
};

/** Render `OM` in white at `topRow` (0 or 2), each column collapsing two pixel rows into one block. */
function renderOmLine(topRow: number, mode: ReturnType<typeof theme.getColorMode>): string {
	const glyphs: string[] = [];
	for (const character of ["O", "M"]) {
		const glyph = GLYPHS[character]!;
		let drawn = "";
		for (let column = 0; column < glyph[0]!.length; column++) {
			const top = glyph[topRow]![column] === "█";
			const bottom = glyph[topRow + 1]![column] === "█";
			drawn += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
		}
		glyphs.push(drawn);
	}
	// Characters are separated by exactly one space; no trailing space, so the caller owns the gap
	// between the prefix and Pi's mark.
	return `${foregroundAnsi(WHITE, mode)}${glyphs.join(" ")}${RESET}`;
}

/**
 * The mark: `OM` in white half blocks followed by Pi's original four-cell logo, unchanged. The
 * prefix identifies the fork while the Pi mark keeps upstream's coral, blue, and yellow.
 */
export function piLogoLines(): [string, string] {
	const mode = theme.getColorMode();
	const fg = (color: typeof CORAL) => foregroundAnsi(color, mode);
	// The fourth cell of the top line is empty, so it is padded to the same width as the bottom line.
	const piTop = `${fg(CORAL)}${backgroundAnsi(BLUE, mode)}▀${RESET}${fg(CORAL)}▀█${RESET} `;
	const piBottom = `${fg(BLUE)}█▀${RESET} ${fg(YELLOW)}█${RESET}`;
	return [`${renderOmLine(0, mode)} ${piTop}`, `${renderOmLine(2, mode)} ${piBottom}`];
}

/**
 * Whether the terminal renders the half-block logo correctly. Apple Terminal draws gaps between rows and
 * misaligns the half blocks, so it gets the text wordmark instead.
 */
export function supportsPiLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo: white `OM` then Pi's coral `P` and yellow `i`. */
export function piWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(WHITE, mode)}OM${RESET}${foregroundAnsi(CORAL, mode)}P${RESET}${foregroundAnsi(YELLOW, mode)}i${RESET}`;
}

/**
 * The product qualifier shown after the mark. Light purple at full intensity: it is brand text like
 * the logo, so it deliberately avoids the theme's dim tokens.
 */
export function productTag(): string {
	return `${foregroundAnsi(LIGHT_PURPLE, theme.getColorMode())}slim${RESET}`;
}

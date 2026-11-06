import { foregroundAnsi, isAppleTerminalSession, rgbColor } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

/**
 * The omp-slim wordmark, four cells wide and two lines tall so it occupies the same slot as the
 * block logo it replaces:
 *
 *   O M P -
 *   S L I M
 *
 * Each letter keeps the brand colors the block logo used — coral for the leading pair, blue for the
 * middle, yellow for the trailing accent — so the header reads the same at a glance.
 */
export function piLogoLines(): [string, string] {
	const mode = theme.getColorMode();
	const fg = (color: typeof CORAL) => foregroundAnsi(color, mode);
	const top = `${fg(CORAL)}OMP${RESET}${fg(YELLOW)}-${RESET}`;
	const bottom = `${fg(BLUE)}SLIM${RESET}`;
	return [top, bottom];
}

/**
 * Whether the terminal renders the wordmark reliably. Apple Terminal misaligns adjacent cells and
 * drops the styling on narrow glyphs, so it gets the plain wordmark instead.
 */
export function supportsPiLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo: the product name in the wordmark's accent and trailing colors. */
export function piWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(CORAL, mode)}omp${RESET}${foregroundAnsi(YELLOW, mode)}-${RESET}${foregroundAnsi(BLUE, mode)}slim${RESET}`;
}

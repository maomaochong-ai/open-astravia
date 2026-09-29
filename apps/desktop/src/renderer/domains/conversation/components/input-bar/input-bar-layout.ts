import type { InputBarContentWidth } from "./types";

/** Maps the host layout to the width of the visible composer surface. */
export function inputBarContentWidthClassName(contentWidth: InputBarContentWidth): string {
	return contentWidth === "message" ? "max-w-3xl" : "max-w-2xl";
}

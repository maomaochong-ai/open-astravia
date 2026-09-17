import type { CSSProperties } from "react";

/**
 * Desktop's global button rule transitions background-color. Keep the shared
 * text/border feedback while making session selection fills paint immediately.
 */
export const IMMEDIATE_SESSION_SELECTION_STYLE = {
	transitionProperty: "color, border-color",
} satisfies CSSProperties;

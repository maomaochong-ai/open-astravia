import type { JSX as ReactJSX } from "react";

/**
 * React 19 removed the global `JSX` namespace (it now lives under `React.JSX`).
 * theme-ui's rendering code uses the long-standing `JSX.Element` return annotation, so
 * restore the global alias here — the Desktop host does the same in its own global.d.ts.
 */
declare global {
	namespace JSX {
		type Element = ReactJSX.Element;
		type IntrinsicElements = ReactJSX.IntrinsicElements;
	}
}

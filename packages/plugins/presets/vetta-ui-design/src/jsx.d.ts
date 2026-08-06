// React 19 types no longer declare a global `JSX` namespace, and this package's
// tsconfig `types` array excludes @types/react's global augmentation. Re-expose
// the `JSX.Element` alias used in component return annotations.
import type { JSX as ReactJSX } from "react";

declare global {
	namespace JSX {
		type Element = ReactJSX.Element;
	}
}

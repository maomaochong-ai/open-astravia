import "../registry";
import type { AppBackground } from "./AppBackground";

declare module "@vetta-org/theme-sdk" {
	interface ThemeComponentRegistry {
		readonly "app.background"?: typeof AppBackground;
	}
}

export type { AppBackgroundProps } from "./AppBackground";
export { AppBackground } from "./AppBackground";
export { AppBootLoadingView } from "./AppBootLoadingView";
export { RouteContentLoadingView } from "./RouteContentLoadingView";

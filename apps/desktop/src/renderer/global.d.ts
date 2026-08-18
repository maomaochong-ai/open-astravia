import type { DesktopApi } from "@preload/api";

declare global {
	interface Window {
		vetta: DesktopApi;
	}
}

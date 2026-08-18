import type { AppshotCapturedPayload, AppshotCaptureErrorPayload } from "../../shared/appshot-ipc.js";

export interface DesktopAppshotApi {
	reloadGesture(): Promise<void>;
	openOnboarding(): Promise<void>;
	onCaptured(handler: (payload: AppshotCapturedPayload) => void): () => void;
	onCaptureError(handler: (payload: AppshotCaptureErrorPayload) => void): () => void;
}

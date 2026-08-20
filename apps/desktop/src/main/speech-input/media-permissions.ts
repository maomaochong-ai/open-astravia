import type {
	MediaAccessPermissionRequest,
	PermissionCheckHandlerHandlerDetails,
	Session,
	WebContents,
} from "electron";

interface MediaPermissionContext {
	stage: "check" | "request";
	mainWebContentsMatches: boolean;
	remoteDesktopWebContentsMatches: boolean;
	isMainFrame: boolean;
	mediaTypes: readonly ("audio" | "video" | "unknown")[];
}

const remoteDesktopVideoWebContentsIds = new Set<number>();

export function isAllowedDesktopMediaRequest(context: MediaPermissionContext): boolean {
	if (!context.isMainFrame) return false;
	// Electron 34 checks getDisplayMedia as video, then sends an empty mediaTypes
	// array for the matching permission request. The registered host needs both.
	if (
		context.remoteDesktopWebContentsMatches &&
		((context.stage === "check" && context.mediaTypes.length === 1 && context.mediaTypes[0] === "video") ||
			(context.stage === "request" && context.mediaTypes.length === 0))
	)
		return true;
	if (context.mediaTypes.length !== 1) return false;
	const [mediaType] = context.mediaTypes;
	return context.mainWebContentsMatches && mediaType === "audio";
}

export function registerRemoteDesktopVideoPermission(webContentsId: number): () => void {
	remoteDesktopVideoWebContentsIds.add(webContentsId);
	return () => remoteDesktopVideoWebContentsIds.delete(webContentsId);
}

export function configureMainWindowMediaPermissions(session: Session, mainWebContents: WebContents): void {
	session.setPermissionCheckHandler((webContents, permission, _origin, details) => {
		if (permission !== "media") return true;
		const context: MediaPermissionContext = {
			stage: "check",
			mainWebContentsMatches: webContents?.id === mainWebContents.id,
			remoteDesktopWebContentsMatches: webContents !== null && remoteDesktopVideoWebContentsIds.has(webContents.id),
			isMainFrame: details.isMainFrame,
			mediaTypes: [(details as PermissionCheckHandlerHandlerDetails).mediaType ?? "unknown"],
		};
		return isAllowedDesktopMediaRequest(context);
	});
	session.setPermissionRequestHandler((webContents, permission, callback, details) => {
		if (permission !== "media") {
			callback(true);
			return;
		}
		const request = details as MediaAccessPermissionRequest;
		const context: MediaPermissionContext = {
			stage: "request",
			mainWebContentsMatches: webContents.id === mainWebContents.id,
			remoteDesktopWebContentsMatches: remoteDesktopVideoWebContentsIds.has(webContents.id),
			isMainFrame: request.isMainFrame,
			mediaTypes: request.mediaTypes ?? [],
		};
		callback(isAllowedDesktopMediaRequest(context));
	});
}

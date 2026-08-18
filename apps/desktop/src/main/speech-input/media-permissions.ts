import type {
	MediaAccessPermissionRequest,
	PermissionCheckHandlerHandlerDetails,
	Session,
	WebContents,
} from "electron";

interface AudioPermissionContext {
	webContentsMatches: boolean;
	isMainFrame: boolean;
	mediaTypes: readonly ("audio" | "video" | "unknown")[];
}

export function isAllowedMainWindowAudioRequest(context: AudioPermissionContext): boolean {
	return (
		context.webContentsMatches &&
		context.isMainFrame &&
		context.mediaTypes.length === 1 &&
		context.mediaTypes[0] === "audio"
	);
}

export function configureMainWindowMediaPermissions(session: Session, mainWebContents: WebContents): void {
	session.setPermissionCheckHandler((webContents, permission, _origin, details) => {
		if (permission !== "media") return true;
		return isAllowedMainWindowAudioRequest({
			webContentsMatches: webContents?.id === mainWebContents.id,
			isMainFrame: details.isMainFrame,
			mediaTypes: [(details as PermissionCheckHandlerHandlerDetails).mediaType ?? "unknown"],
		});
	});
	session.setPermissionRequestHandler((webContents, permission, callback, details) => {
		if (permission !== "media") {
			callback(true);
			return;
		}
		const request = details as MediaAccessPermissionRequest;
		callback(
			isAllowedMainWindowAudioRequest({
				webContentsMatches: webContents.id === mainWebContents.id,
				isMainFrame: request.isMainFrame,
				mediaTypes: request.mediaTypes ?? ["unknown"],
			}),
		);
	});
}

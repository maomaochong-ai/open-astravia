import type {
	MediaAccessPermissionRequest,
	PermissionCheckHandlerHandlerDetails,
	Session,
	WebContents,
} from "electron";
import { systemPreferences } from "electron";

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

/**
 * 确保系统层面允许使用麦克风。
 *
 * macOS 的 TCC 授权与 Chromium 的权限处理器是两道独立的门：`setPermissionRequestHandler`
 * 只回答「这个页面能不能用麦克风」，系统弹窗要由 `askForMediaAccess` 触发。缺这一步时
 * `getUserMedia` 会直接以 NotAllowedError 失败，用户看到的是「点了录音没反应」。
 * Windows 的麦克风开关由系统隐私设置把关，Chromium 自己会弹，这里不需要额外动作。
 */
export async function ensureMicrophoneAccess(): Promise<boolean> {
	if (process.platform !== "darwin") return true;
	const status = systemPreferences.getMediaAccessStatus("microphone");
	if (status === "granted") return true;
	// 用户已明确拒绝或受策略限制时不再弹窗（系统也不会再弹），直接如实返回。
	if (status === "denied" || status === "restricted") return false;
	return systemPreferences.askForMediaAccess("microphone");
}

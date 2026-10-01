// Astravia Computer Use 授权引导窗主进程 <-> 渲染进程 IPC 契约。
// 通道字符串以此文件为唯一来源；preload 实现文件（preload/onboarding.ts）内必须
// 内联字面量，不 import 本文件（见 preload/quickpanel.ts 的坑）。

export const ONBOARDING_CHANNELS = {
	// onboarding renderer → main invoke
	CHECK_PERMISSIONS: "astravia:onboarding:check-permissions", // 查 helper 权限 → {accessibility, screenRecording}
	REQUEST_PERMISSIONS: "astravia:onboarding:request-permissions", // 弹系统授权 → 同上
	OPEN_PANE: "astravia:permissions:open-pane", // 复用现成，传 "accessibility"|"screen-recording"
	START_DRAG: "astravia:onboarding:start-drag", // 拖 helper.app 到系统设置；main 侧 event.sender.startDrag({file, icon})
	CLOSE: "astravia:onboarding:close",
	// main → onboarding renderer event
	PERMISSIONS_UPDATED: "astravia:onboarding:permissions-updated",
	DRAG_ERROR: "astravia:onboarding:drag-error", // helper.app 缺失/startDrag 抛异常时通知渲染进程展示反馈
} as const;

export interface HelperPermissions {
	accessibility: boolean;
	screenRecording: boolean;
}

export type OnboardingPaneKind = "accessibility" | "screen-recording";

// preload bridge（window.astraviaOnboarding）。preload 实现只 type-import 本接口
// （值仍走内联字面量，见文件头注释）。
export interface OnboardingBridge {
	// App 语言真相源（desktop-config），preload 求值期同步 sendSync 取得。
	initialLanguage: string;
	checkPermissions(): Promise<HelperPermissions>;
	requestPermissions(): Promise<HelperPermissions>;
	openPane(kind: OnboardingPaneKind): Promise<void>;
	startDrag(): void;
	close(): Promise<void>;
	onPermissionsUpdated(handler: (perms: HelperPermissions) => void): () => void;
	onDragError(handler: () => void): () => void;
	onLanguageChanged(handler: (lang: string) => void): () => void;
}

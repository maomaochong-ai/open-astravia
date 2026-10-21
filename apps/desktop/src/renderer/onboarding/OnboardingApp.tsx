import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HelperPermissions, OnboardingBridge } from "../../shared/onboarding-ipc";
import { DragTarget } from "./DragTarget";
import { subscribeOnboardingLanguage } from "./i18n";
import { PermissionRow } from "./PermissionRow";

declare global {
	interface Window {
		astraviaOnboarding?: OnboardingBridge;
	}
}

// 完成后自动关闭引导窗前的停留时间，让用户看到「已完成」提示。
const AUTO_CLOSE_DELAY_MS = 1200;

// 系统设置里的勾选不会派发任何事件，只能按间隔轮询 helper 的真实权限状态。
const PERMISSION_POLL_MS = 1500;

export function OnboardingApp(): JSX.Element {
	const { t } = useTranslation("settings");
	const [permissions, setPermissions] = useState<HelperPermissions | null>(null);
	const [loading, setLoading] = useState(true);
	const [dragError, setDragError] = useState(false);
	const [requesting, setRequesting] = useState(false);
	const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const refresh = useCallback(async () => {
		const bridge = window.astraviaOnboarding;
		if (!bridge) return;
		try {
			const perms = await bridge.checkPermissions();
			setPermissions(perms);
		} finally {
			setLoading(false);
		}
	}, []);

	// 首帧查一次；窗口重获焦点时（用户从「系统设置」切回）再查一次。
	// 焦点事件并不可靠（全屏切换、点回同一应用等场景不触发），叠加可见期轮询。
	useEffect(() => {
		void refresh();
		const handler = () => void refresh();
		window.addEventListener("focus", handler);
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refresh();
		}, PERMISSION_POLL_MS);
		return () => {
			window.removeEventListener("focus", handler);
			window.clearInterval(timer);
		};
	}, [refresh]);

	// 主进程推送的权限更新（check/request-permissions 调用后）。
	useEffect(() => {
		const bridge = window.astraviaOnboarding;
		if (!bridge) return;
		return bridge.onPermissionsUpdated((perms) => {
			setPermissions(perms);
			setLoading(false);
		});
	}, []);

	// helper.app 缺失/startDrag 抛异常时主进程会推送该事件，用于给用户可见反馈（否则拖拽悄无声息失败）。
	useEffect(() => {
		const bridge = window.astraviaOnboarding;
		if (!bridge) return;
		return bridge.onDragError(() => setDragError(true));
	}, []);

	useEffect(() => subscribeOnboardingLanguage(), []);

	const allGranted = permissions !== null && permissions.accessibility && permissions.screenRecording;

	// 双授权完成：停留片刻后自动关闭引导窗。
	useEffect(() => {
		if (!allGranted) return;
		autoCloseTimer.current = setTimeout(() => {
			void window.astraviaOnboarding?.close();
		}, AUTO_CLOSE_DELAY_MS);
		return () => {
			if (autoCloseTimer.current !== null) clearTimeout(autoCloseTimer.current);
		};
	}, [allGranted]);

	const handleOpenPane = useCallback((kind: "accessibility" | "screen-recording") => {
		void window.astraviaOnboarding?.openPane(kind);
	}, []);

	// requestPermissions 走 helper 自己的 --request-permissions：只有 helper 这个独立 TCC
	// 主体能触发系统授权框并把自己的条目注册进列表，主进程代劳没有这个效果。
	const handleRequest = useCallback(async () => {
		const bridge = window.astraviaOnboarding;
		if (!bridge) return;
		setDragError(false);
		setRequesting(true);
		try {
			const perms = await bridge.requestPermissions();
			setPermissions(perms);
			// 系统授权框只把 helper 注册进隐私列表，真正的勾选必须在系统设置里完成。
			// 请求后仍未授权就直接把用户带到第一个待授权面板，否则看起来像按钮没反应。
			if (!perms.accessibility) handleOpenPane("accessibility");
			else if (!perms.screenRecording) handleOpenPane("screen-recording");
		} finally {
			setRequesting(false);
			setLoading(false);
		}
	}, [handleOpenPane]);

	// helper 用 ad-hoc 签名时 TCC 以 cdhash 记身份，重建后就对不上旧勾选，界面上表现为
	// 「系统设置里已勾选但仍是未授权」。清空记录后重新拖入才能建立有效条目。
	const handleReset = useCallback(async () => {
		const bridge = window.astraviaOnboarding;
		if (!bridge) return;
		setDragError(false);
		setRequesting(true);
		try {
			await bridge.resetPermissions();
			setPermissions(await bridge.checkPermissions());
			void bridge.openPane("accessibility");
		} finally {
			setRequesting(false);
			setLoading(false);
		}
	}, []);

	const handleDragStart = useCallback(() => {
		setDragError(false);
		window.astraviaOnboarding?.startDrag();
	}, []);

	const handleClose = useCallback(() => {
		void window.astraviaOnboarding?.close();
	}, []);

	return (
		<div className="flex h-screen w-screen flex-col rounded-2xl border border-border/60 bg-popover p-5 text-popover-foreground shadow-2xl [-webkit-app-region:drag]">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-[16px] font-semibold text-foreground">{t("onboardingTitle")}</h1>
					<p className="mt-1 text-[12px] text-muted-foreground">{t("onboardingDesc")}</p>
				</div>
				<button
					type="button"
					onClick={handleClose}
					aria-label={t("close")}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [-webkit-app-region:no-drag]"
				>
					<span className="icon-[mdi--close] h-4 w-4" />
				</button>
			</div>

			<div className="mt-4 divide-y divide-border/60 rounded-xl border border-border/60 px-4">
				<PermissionRow
					title={t("onboardingPermAccessibility")}
					description={t("onboardingPermAccessibilityDesc")}
					granted={permissions?.accessibility ?? false}
					loading={loading}
					buttonLabel={t("onboardingOpenSettings")}
					doneLabel={t("onboardingDone")}
					onOpenPane={() => handleOpenPane("accessibility")}
				/>
				<PermissionRow
					title={t("onboardingPermScreen")}
					description={t("onboardingPermScreenDesc")}
					granted={permissions?.screenRecording ?? false}
					loading={loading}
					buttonLabel={t("onboardingOpenSettings")}
					doneLabel={t("onboardingDone")}
					onOpenPane={() => handleOpenPane("screen-recording")}
				/>
			</div>

			{!allGranted && (
				<>
					<button
						type="button"
						onClick={() => void handleRequest()}
						disabled={requesting || loading}
						className="mt-4 flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 [-webkit-app-region:no-drag]"
					>
						<span
							className={
								requesting
									? "icon-[mdi--loading] h-4 w-4 animate-spin"
									: "icon-[mdi--shield-key-outline] h-4 w-4"
							}
						/>
						{requesting ? t("onboardingRequesting") : t("onboardingRequest")}
					</button>
					<p className="mt-2 shrink-0 text-center text-[11px] text-muted-foreground [-webkit-app-region:no-drag]">
						{t("onboardingRequestHint")}
					</p>
					<button
						type="button"
						onClick={() => void handleReset()}
						disabled={requesting || loading}
						className="mt-1 w-full shrink-0 text-center text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground disabled:opacity-60 [-webkit-app-region:no-drag]"
					>
						{t("onboardingResetPermissions")}
					</button>
				</>
			)}

			<DragTarget iconUrl="./icon.png" hint={t("onboardingDragHint")} onDragStart={handleDragStart} />

			{dragError && (
				<p className="mt-2 text-center text-[12px] font-medium text-destructive">{t("onboardingDragError")}</p>
			)}

			{allGranted && (
				<p className="mt-4 text-center text-[12px] font-medium text-emerald-500">{t("onboardingAllGranted")}</p>
			)}
		</div>
	);
}

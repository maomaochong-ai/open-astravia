import type { ImFeishuBindEvent } from "@preload/api";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Feishu one-click app registration dialog.
 *
 * The platform mints the app itself: scanning the code opens a page where
 * the user creates the bot and confirms the scopes the bridge declared, and
 * the credentials come back over the sidecar. Everything the manual route
 * asked for — create app, enable bot, tick scopes, subscribe events,
 * publish, copy two secrets — collapses into that one scan, so the typed
 * form stays only as the escape hatch behind "手动填写".
 */
type FeishuDialogPhase = "idle" | "starting" | "waiting" | "confirmed" | "failed";

interface FeishuDialogState {
	phase: FeishuDialogPhase;
	qrUrl?: string;
	qrDataUrl?: string;
	qrAttempt: number;
	error?: string;
}

const initialFeishuDialogState: FeishuDialogState = { phase: "idle", qrAttempt: 0 };

export interface FeishuBindDialogModel {
	readonly bodyKind: "loading" | "failed" | "confirmed" | "qr" | "bound";
	readonly bound: boolean;
	readonly appId?: string;
	readonly error?: string;
	readonly labels: {
		readonly appIdLabel: string;
		readonly bindDesc: string;
		readonly bindDone: string;
		readonly bindFailed: string;
		readonly bindGenerating: string;
		readonly bindSuccessDesc: string;
		readonly bindSuccessTitle: string;
		readonly cancel: string;
		readonly manual: string;
		readonly qrAlt: string;
		readonly retry: string;
		readonly scanToAuthorize: string;
		readonly title: string;
		readonly unbindAccount: string;
	};
	readonly onLogout: () => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly onOpenGuide: () => void;
	readonly onOpenManual: () => void;
	readonly onStart: () => void;
	readonly open: boolean;
	readonly progressLabel: string;
	readonly qrDataUrl?: string;
}

export function useFeishuBindDialogModel({
	open,
	onOpenChange,
	bound,
	appId,
	onLogout,
	onConfirmedRefresh,
	onOpenManual,
	onOpenGuide,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bound: boolean;
	appId?: string;
	onLogout: () => void;
	onConfirmedRefresh: () => void;
	onOpenManual: () => void;
	onOpenGuide: () => void;
}): FeishuBindDialogModel {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<FeishuDialogState>(initialFeishuDialogState);
	const subUnsubRef = useRef<(() => void) | null>(null);
	// The success screen closes itself after a beat; keep the handle so an
	// unmount cannot fire it later.
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			subUnsubRef.current?.();
			subUnsubRef.current = null;
			if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
		},
		[],
	);

	useEffect(() => {
		if (!open) {
			subUnsubRef.current?.();
			subUnsubRef.current = null;
			setState(initialFeishuDialogState);
		}
	}, [open]);

	useEffect(() => {
		const url = state.qrUrl;
		if (!url) return;
		let cancelled = false;
		QRCode.toDataURL(url, {
			errorCorrectionLevel: "M",
			margin: 1,
			width: 240,
			color: { dark: "#000000", light: "#ffffff" },
		})
			.then((dataUrl) => {
				if (!cancelled) {
					setState((prev) => (prev.qrUrl === url ? { ...prev, qrDataUrl: dataUrl } : prev));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setState((prev) => ({ ...prev, error: t("qrRenderError") }));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [state.qrUrl, t]);

	const startBind = useCallback(async () => {
		setState({ phase: "starting", qrAttempt: 0 });
		const unsub = await window.vetta.im.feishu.subscribeBind((event: ImFeishuBindEvent) => {
			switch (event.kind) {
				case "qr":
					setState((prev) => ({
						...prev,
						phase: "waiting",
						qrUrl: event.url,
						qrDataUrl: undefined,
						qrAttempt: event.attempt,
						error: undefined,
					}));
					break;
				case "status":
					setState((prev) => {
						switch (event.status) {
							case "confirmed":
								return { ...prev, phase: "confirmed" };
							case "expired":
								return { ...prev, phase: "failed", error: t("feishuQrExpired") };
							case "failed":
								return { ...prev, phase: "failed", error: event.error ?? t("bindFailedGeneric") };
							case "cancelled":
								return { ...prev, phase: "failed", error: t("bindCanceled") };
							default:
								return prev;
						}
					});
					break;
				case "bound":
					onConfirmedRefresh();
					setState((prev) => ({ ...prev, phase: "confirmed" }));
					closeTimerRef.current = setTimeout(() => onOpenChange(false), 1500);
					break;
				case "unbound":
					setState(initialFeishuDialogState);
					onConfirmedRefresh();
					break;
			}
		});
		subUnsubRef.current = unsub;

		const result = await window.vetta.im.feishu.startBind();
		if (!result.ok) {
			setState({ phase: "failed", qrAttempt: 0, error: result.error ?? t("bindStartFailed") });
		}
	}, [onConfirmedRefresh, onOpenChange, t]);

	// Auto-start on open so the code is already there when the user looks.
	useEffect(() => {
		if (open && !bound && state.phase === "idle") {
			void startBind();
		}
	}, [bound, open, startBind, state.phase]);

	const bodyKind = (() => {
		if (bound) return "bound" as const;
		if (state.phase === "idle" || state.phase === "starting") return "loading" as const;
		if (state.phase === "failed") return "failed" as const;
		if (state.phase === "confirmed") return "confirmed" as const;
		return "qr" as const;
	})();

	const progressLabel = state.qrAttempt > 1 ? t("feishuScanQrHintN", { n: state.qrAttempt }) : t("feishuScanQrHint");

	return useMemo(
		() => ({
			bodyKind,
			bound,
			appId,
			error: state.error,
			labels: {
				appIdLabel: t("feishuAppIdLabel"),
				bindDesc: bound ? t("feishuBoundDesc") : t("feishuBindDesc"),
				bindDone: t("bindDone"),
				bindFailed: t("bindFailed"),
				bindGenerating: t("bindGenerating"),
				bindSuccessDesc: t("feishuBindSuccessDesc"),
				bindSuccessTitle: t("bindSuccessTitle"),
				cancel: t("cancel"),
				manual: t("feishuManual"),
				qrAlt: t("feishuQrAlt"),
				retry: t("retry"),
				scanToAuthorize: t("feishuScanToAuthorize"),
				title: bound ? t("feishuTitle") : t("feishuBindTitle"),
				unbindAccount: t("feishuUnbindApp"),
			},
			onLogout,
			onOpenChange,
			onOpenGuide,
			onOpenManual,
			onStart: () => {
				void startBind();
			},
			open,
			progressLabel,
			qrDataUrl: state.qrDataUrl,
		}),
		[
			appId,
			bodyKind,
			bound,
			onLogout,
			onOpenChange,
			onOpenGuide,
			onOpenManual,
			open,
			progressLabel,
			startBind,
			state.error,
			state.qrDataUrl,
			t,
		],
	);
}

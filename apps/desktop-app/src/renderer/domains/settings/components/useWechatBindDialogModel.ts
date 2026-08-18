import type { ImWechatBindEvent } from "@preload/api";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type WechatDialogPhase =
	| "idle"
	| "starting"
	| "waiting"
	| "scanned"
	| "expired_refreshing"
	| "redirected"
	| "confirmed"
	| "failed";

interface WechatDialogState {
	phase: WechatDialogPhase;
	qrUrl?: string;
	qrDataUrl?: string;
	qrAttempt: number;
	error?: string;
}

const initialWechatDialogState: WechatDialogState = {
	phase: "idle",
	qrAttempt: 0,
};

export interface WechatBindDialogModel {
	readonly bodyKind: "loading" | "failed" | "confirmed" | "qr" | "bound";
	readonly bound: boolean;
	readonly error?: string;
	readonly ilinkBotId?: string;
	readonly ilinkUserId?: string;
	readonly labels: {
		readonly bindCanceled: string;
		readonly bindDesc: string;
		readonly bindDone: string;
		readonly bindFailed: string;
		readonly bindGenerating: string;
		readonly bindSuccessDesc: string;
		readonly bindSuccessTitle: string;
		readonly bindTitle: string;
		readonly cancel: string;
		readonly qrExpired: string;
		readonly retry: string;
		readonly scanQrHint: string;
		readonly scanToAuthorize: string;
		readonly scanWechatConfirm: string;
		readonly switchingRoute: string;
		readonly title: string;
		readonly unbindAccount: string;
	};
	readonly onLogout: () => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly onStart: () => void;
	readonly open: boolean;
	readonly progressLabel: string;
	readonly qrDataUrl?: string;
}

export function useWechatBindDialogModel({
	open,
	onOpenChange,
	bound,
	ilinkBotId,
	ilinkUserId,
	onLogout,
	onConfirmedRefresh,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bound: boolean;
	ilinkBotId?: string;
	ilinkUserId?: string;
	onLogout: () => void;
	onConfirmedRefresh: () => void;
}): WechatBindDialogModel {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<WechatDialogState>(initialWechatDialogState);
	const subUnsubRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		if (!open) {
			subUnsubRef.current?.();
			subUnsubRef.current = null;
			setState(initialWechatDialogState);
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
		const unsub = await window.vetta.im.wechat.subscribeBind((event: ImWechatBindEvent) => {
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
							case "scanned":
								return { ...prev, phase: "scanned" };
							case "expired":
								return { ...prev, phase: "expired_refreshing" };
							case "redirected":
								return { ...prev, phase: "redirected" };
							case "confirmed":
								return { ...prev, phase: "confirmed" };
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
					setTimeout(() => onOpenChange(false), 1500);
					break;
				case "unbound":
					setState(initialWechatDialogState);
					onConfirmedRefresh();
					break;
			}
		});
		subUnsubRef.current = unsub;

		const result = await window.vetta.im.wechat.startBind();
		if (!result.ok) {
			setState({
				phase: "failed",
				qrAttempt: 0,
				error: result.error ?? t("bindStartFailed"),
			});
		}
	}, [onConfirmedRefresh, onOpenChange, t]);

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

	const progressLabel = (() => {
		switch (state.phase) {
			case "scanned":
				return t("scanWechatConfirm");
			case "expired_refreshing":
				return t("qrExpired");
			case "redirected":
				return t("switchingRoute");
			default:
				return state.qrAttempt > 1 ? t("scanQrHintN", { n: state.qrAttempt }) : t("scanQrHint");
		}
	})();

	return useMemo(
		() => ({
			bodyKind,
			bound,
			error: state.error,
			ilinkBotId,
			ilinkUserId,
			labels: {
				bindCanceled: t("bindCanceled"),
				bindDesc: bound ? t("wechatBoundDesc") : t("wechatBindDesc"),
				bindDone: t("bindDone"),
				bindFailed: t("bindFailed"),
				bindGenerating: t("bindGenerating"),
				bindSuccessDesc: t("bindSuccessDesc"),
				bindSuccessTitle: t("bindSuccessTitle"),
				bindTitle: t("wechatBindTitle"),
				cancel: t("cancel"),
				qrExpired: t("qrExpired"),
				retry: t("retry"),
				scanQrHint: t("scanQrHint"),
				scanToAuthorize: t("scanToAuthorize"),
				scanWechatConfirm: t("scanWechatConfirm"),
				switchingRoute: t("switchingRoute"),
				title: bound ? t("wechatTitle") : t("wechatBindTitle"),
				unbindAccount: t("unbindAccount"),
			},
			onLogout,
			onOpenChange,
			onStart: () => {
				void startBind();
			},
			open,
			progressLabel,
			qrDataUrl: state.qrDataUrl,
		}),
		[
			bodyKind,
			bound,
			ilinkBotId,
			ilinkUserId,
			onLogout,
			onOpenChange,
			open,
			progressLabel,
			startBind,
			state.error,
			state.qrDataUrl,
			t,
		],
	);
}

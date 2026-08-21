import type { ImSignalBindEvent } from "@preload/api";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Signal device-link dialog.
 *
 * Signal has no bot API, so the bridge drives signal-cli. Everything the
 * user used to do by hand — start the daemon, pick a port, run
 * `signal-cli link`, copy the account number into settings — happens in the
 * sidecar now; what is left here is showing the QR and the one prerequisite
 * we cannot remove: signal-cli must be installed.
 */
type SignalDialogPhase = "idle" | "starting" | "waiting" | "confirmed" | "failed";

interface SignalDialogState {
	phase: SignalDialogPhase;
	qrUri?: string;
	qrDataUrl?: string;
	qrAttempt: number;
	error?: string;
}

const initialSignalDialogState: SignalDialogState = { phase: "idle", qrAttempt: 0 };

export interface SignalBindDialogModel {
	readonly bodyKind: "loading" | "failed" | "confirmed" | "qr" | "bound";
	readonly bound: boolean;
	readonly account?: string;
	readonly error?: string;
	/** signal-cli is missing; the QR flow cannot start. */
	readonly cliMissing: boolean;
	readonly installHint: string;
	readonly onOpenAdvanced: () => void;
	readonly onOpenGuide: () => void;
	readonly labels: {
		readonly accountLabel: string;
		readonly advanced: string;
		readonly bindDesc: string;
		readonly bindDone: string;
		readonly bindFailed: string;
		readonly bindGenerating: string;
		readonly bindSuccessDesc: string;
		readonly bindSuccessTitle: string;
		readonly cancel: string;
		readonly cliMissingDesc: string;
		readonly cliMissingTitle: string;
		readonly qrAlt: string;
		readonly retry: string;
		readonly scanToAuthorize: string;
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

export function useSignalBindDialogModel({
	open,
	onOpenChange,
	bound,
	account,
	cliDetectedPath,
	cliInstallHint,
	onLogout,
	onConfirmedRefresh,
	onOpenAdvanced,
	onOpenGuide,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	bound: boolean;
	account?: string;
	cliDetectedPath?: string;
	cliInstallHint: string;
	onLogout: () => void;
	onConfirmedRefresh: () => void;
	onOpenAdvanced: () => void;
	onOpenGuide: () => void;
}): SignalBindDialogModel {
	const { t } = useTranslation("settings");
	const [state, setState] = useState<SignalDialogState>(initialSignalDialogState);
	const subUnsubRef = useRef<(() => void) | null>(null);
	// The success screen closes itself after a beat; keep the handle so an
	// unmount (dialog closed, settings page left) cannot fire it later.
	const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cliMissing = !cliDetectedPath;

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
			setState(initialSignalDialogState);
		}
	}, [open]);

	useEffect(() => {
		const uri = state.qrUri;
		if (!uri) return;
		let cancelled = false;
		QRCode.toDataURL(uri, {
			errorCorrectionLevel: "M",
			margin: 1,
			width: 240,
			color: { dark: "#000000", light: "#ffffff" },
		})
			.then((dataUrl) => {
				if (!cancelled) {
					setState((prev) => (prev.qrUri === uri ? { ...prev, qrDataUrl: dataUrl } : prev));
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
	}, [state.qrUri, t]);

	const startBind = useCallback(async () => {
		setState({ phase: "starting", qrAttempt: 0 });
		const unsub = await window.vetta.im.signal.subscribeBind((event: ImSignalBindEvent) => {
			switch (event.kind) {
				case "qr":
					setState((prev) => ({
						...prev,
						phase: "waiting",
						qrUri: event.uri,
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
					setState(initialSignalDialogState);
					onConfirmedRefresh();
					break;
			}
		});
		subUnsubRef.current = unsub;

		const result = await window.vetta.im.signal.startBind();
		if (!result.ok) {
			setState({ phase: "failed", qrAttempt: 0, error: result.error ?? t("bindStartFailed") });
		}
	}, [onConfirmedRefresh, onOpenChange, t]);

	// Auto-start on open, but never while signal-cli is missing: the user
	// has to install it first and a failing link would only add noise.
	useEffect(() => {
		if (open && !bound && !cliMissing && state.phase === "idle") {
			void startBind();
		}
	}, [bound, cliMissing, open, startBind, state.phase]);

	const bodyKind = (() => {
		if (bound) return "bound" as const;
		if (cliMissing) return "failed" as const;
		if (state.phase === "idle" || state.phase === "starting") return "loading" as const;
		if (state.phase === "failed") return "failed" as const;
		if (state.phase === "confirmed") return "confirmed" as const;
		return "qr" as const;
	})();

	const error = cliMissing ? t("signalCliMissingDesc", { command: cliInstallHint }) : state.error;

	const progressLabel = state.qrAttempt > 1 ? t("scanQrHintN", { n: state.qrAttempt }) : t("signalScanQrHint");

	return useMemo(
		() => ({
			bodyKind,
			bound,
			account,
			error,
			cliMissing,
			installHint: cliInstallHint,
			onOpenAdvanced,
			onOpenGuide,
			labels: {
				accountLabel: t("signalAccountLabel"),
				advanced: t("signalAdvanced"),
				bindDesc: bound ? t("signalBoundDesc") : t("signalBindDesc"),
				bindDone: t("bindDone"),
				bindFailed: t("bindFailed"),
				bindGenerating: t("bindGenerating"),
				bindSuccessDesc: t("signalBindSuccessDesc"),
				bindSuccessTitle: t("bindSuccessTitle"),
				cancel: t("cancel"),
				cliMissingDesc: t("signalCliMissingDesc", { command: cliInstallHint }),
				cliMissingTitle: t("signalCliMissingTitle"),
				qrAlt: t("signalQrAlt"),
				retry: t("retry"),
				scanToAuthorize: t("signalScanToAuthorize"),
				title: bound ? t("signalTitle") : t("signalBindTitle"),
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
			account,
			bodyKind,
			bound,
			cliInstallHint,
			cliMissing,
			error,
			onLogout,
			onOpenAdvanced,
			onOpenGuide,
			onOpenChange,
			open,
			progressLabel,
			startBind,
			state.qrDataUrl,
			t,
		],
	);
}

import type { SpeechInputErrorCode, SpeechInputStatus } from "@preload/api";
import { isWindows } from "@shared/lib/platform";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MicrophonePcmCapture } from "../../services/microphone-pcm-capture";
import { focusInputEditor, insertPlainText } from "./editor/inputEditorHandle";
import type { SpeechInputModel } from "./types";

const INITIAL_STATUS: SpeechInputStatus = {
	supported: false,
	phase: "unsupported",
	modelId: "",
	downloadedBytes: 0,
	totalBytes: 0,
};

function percentage(status: SpeechInputStatus): number {
	if (status.totalBytes <= 0) return 0;
	return Math.min(100, Math.round((status.downloadedBytes / status.totalBytes) * 100));
}

export function useSpeechInput(enabled: boolean): SpeechInputModel {
	const { t } = useTranslation("chat");
	const [status, setStatus] = useState<SpeechInputStatus>(INITIAL_STATUS);
	const [partialText, setPartialText] = useState("");
	const captureRef = useRef<MicrophonePcmCapture | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const busyRef = useRef(false);

	useEffect(() => {
		if (!isWindows) return;
		let active = true;
		const unsubscribe = window.vetta.speechInput.onEvent((event) => {
			if (!active) return;
			if (event.type === "status") setStatus(event.status);
			if (event.type === "partial") setPartialText(event.text);
			if (event.type === "final" && event.text) {
				setPartialText("");
				insertPlainText(event.text);
				focusInputEditor();
			}
			if (event.type === "error") {
				setStatus((current) => ({ ...current, phase: "error", errorCode: event.code }));
			}
		});
		void window.vetta.speechInput.getStatus().then((next) => {
			if (active) setStatus(next);
		});
		return () => {
			active = false;
			unsubscribe();
			void captureRef.current?.stop();
			if (sessionIdRef.current) void window.vetta.speechInput.cancel(sessionIdRef.current);
		};
	}, []);

	const stop = useCallback(async (): Promise<void> => {
		const sessionId = sessionIdRef.current;
		sessionIdRef.current = null;
		const capture = captureRef.current;
		captureRef.current = null;
		await capture?.stop();
		if (sessionId) await window.vetta.speechInput.stop(sessionId);
		setPartialText("");
	}, []);

	const toggle = useCallback(async (): Promise<void> => {
		if (!enabled || !isWindows) return;
		if (status.phase === "downloading") {
			await window.vetta.speechInput.cancelDownload();
			return;
		}
		if (busyRef.current) return;
		busyRef.current = true;
		try {
			if (sessionIdRef.current) {
				await stop();
				return;
			}
			let readyStatus = status;
			if (status.phase === "missing-model" || status.phase === "error") {
				readyStatus = await window.vetta.speechInput.downloadModel();
				setStatus(readyStatus);
			}
			if (readyStatus.phase !== "ready") return;

			const { sessionId } = await window.vetta.speechInput.start();
			sessionIdRef.current = sessionId;
			const capture = new MicrophonePcmCapture();
			captureRef.current = capture;
			try {
				await capture.start((samples) => window.vetta.speechInput.pushAudio(sessionId, samples));
			} catch {
				captureRef.current = null;
				sessionIdRef.current = null;
				await window.vetta.speechInput.cancel(sessionId);
				setStatus((current) => ({
					...current,
					phase: "error",
					errorCode: "recognizer-start-failed",
				}));
			}
		} catch {
			setStatus((current) => ({
				...current,
				phase: "error",
				errorCode: "recognizer-start-failed",
			}));
		} finally {
			busyRef.current = false;
		}
	}, [enabled, status, stop]);

	const errorText = useCallback(
		(code?: SpeechInputErrorCode): string => {
			switch (code) {
				case "model-integrity-failed":
					return t("inputBar.speech.errors.integrity");
				case "model-download-failed":
					return t("inputBar.speech.errors.download");
				case "unsupported-platform":
					return t("inputBar.speech.errors.unsupported");
				default:
					return t("inputBar.speech.errors.recognizer");
			}
		},
		[t],
	);

	return useMemo(() => {
		const progress = percentage(status);
		const titleByPhase: Record<SpeechInputStatus["phase"], string> = {
			unsupported: t("inputBar.speech.errors.unsupported"),
			"missing-model": t("inputBar.speech.actions.downloadAndStart"),
			downloading: t("inputBar.speech.actions.cancelDownload", { progress }),
			ready: t("inputBar.speech.actions.start"),
			loading: t("inputBar.speech.states.loading"),
			listening: t("inputBar.speech.actions.stop"),
			stopping: t("inputBar.speech.states.stopping"),
			error: errorText(status.errorCode),
		};
		const statusText = partialText
			? partialText
			: status.phase === "downloading"
				? t("inputBar.speech.states.downloading", { progress })
				: status.phase === "loading" || status.phase === "stopping"
					? titleByPhase[status.phase]
					: status.phase === "error"
						? titleByPhase.error
						: null;
		return {
			visible: isWindows,
			active: status.phase === "listening",
			disabled: !enabled || status.phase === "loading" || status.phase === "stopping",
			title: titleByPhase[status.phase],
			statusText,
			onToggle: () => void toggle(),
		};
	}, [enabled, errorText, partialText, status, t, toggle]);
}

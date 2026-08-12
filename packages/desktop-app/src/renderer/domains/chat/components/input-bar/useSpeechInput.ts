import type { SpeechInputErrorCode, SpeechInputStatus } from "@preload/api";
import { isWindows } from "@shared/lib/platform";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MicrophonePcmCapture } from "../../services/microphone-pcm-capture";
import { clearSpeechText, focusInputEditor, replaceSpeechText } from "./editor/inputEditorHandle";
import type { SpeechInputModel } from "./types";

const INITIAL_STATUS: SpeechInputStatus = {
	supported: false,
	phase: "unsupported",
	modelId: "",
};

export function useSpeechInput(enabled: boolean): SpeechInputModel {
	const { t } = useTranslation("chat");
	const [status, setStatus] = useState<SpeechInputStatus>(INITIAL_STATUS);
	const captureRef = useRef<MicrophonePcmCapture | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const busyRef = useRef(false);

	useEffect(() => {
		if (!isWindows) return;
		let active = true;
		const unsubscribe = window.vetta.speechInput.onEvent((event) => {
			if (!active) return;
			if (event.type === "status") setStatus(event.status);
			if (event.type === "partial") replaceSpeechText(event.text);
			if (event.type === "final" && event.text) {
				replaceSpeechText(event.text);
				clearSpeechText();
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
			clearSpeechText();
		};
	}, []);

	const stop = useCallback(async (): Promise<void> => {
		const sessionId = sessionIdRef.current;
		sessionIdRef.current = null;
		const capture = captureRef.current;
		captureRef.current = null;
		await capture?.stop();
		if (sessionId) await window.vetta.speechInput.stop(sessionId);
		clearSpeechText();
	}, []);

	const toggle = useCallback(async (): Promise<void> => {
		if (!enabled || !isWindows) return;
		if (busyRef.current) return;
		busyRef.current = true;
		try {
			if (sessionIdRef.current) {
				await stop();
				return;
			}
			let readyStatus = status;
			if (status.phase === "error") {
				readyStatus = await window.vetta.speechInput.getStatus();
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
				case "bundled-model-invalid":
					return t("inputBar.speech.errors.integrity");
				case "bundled-model-missing":
					return t("inputBar.speech.errors.missing");
				case "unsupported-platform":
					return t("inputBar.speech.errors.unsupported");
				default:
					return t("inputBar.speech.errors.recognizer");
			}
		},
		[t],
	);

	return useMemo(() => {
		const titleByPhase: Record<SpeechInputStatus["phase"], string> = {
			unsupported: t("inputBar.speech.errors.unsupported"),
			unavailable: errorText(status.errorCode),
			ready: t("inputBar.speech.actions.start"),
			loading: t("inputBar.speech.states.loading"),
			listening: t("inputBar.speech.actions.stop"),
			stopping: t("inputBar.speech.states.stopping"),
			error: errorText(status.errorCode),
		};
		const statusText =
			status.phase === "loading" || status.phase === "stopping"
				? titleByPhase[status.phase]
				: status.phase === "error" || status.phase === "unavailable"
					? titleByPhase[status.phase]
					: null;
		return {
			visible: isWindows,
			active: status.phase === "listening",
			disabled:
				!enabled || status.phase === "unavailable" || status.phase === "loading" || status.phase === "stopping",
			title: titleByPhase[status.phase],
			statusText,
			onToggle: () => void toggle(),
		};
	}, [enabled, errorText, status, t, toggle]);
}

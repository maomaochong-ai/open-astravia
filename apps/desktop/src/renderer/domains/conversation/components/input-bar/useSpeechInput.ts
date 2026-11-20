import type { SpeechInputErrorCode, SpeechInputStatus } from "@preload/api";
import { isSpeechInputPlatform } from "@shared/lib/platform";
import { showToast } from "@shared/store/toast-atoms";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isSpeechInputBuildEnabled } from "@/shared/feature-flags";
import { MicrophonePcmCapture } from "../../services/microphone-pcm-capture";
import { clearSpeechText, focusInputEditor, replaceSpeechText } from "./editor/inputEditorHandle";
import type { SpeechInputModel } from "./types";

/** 约 4 秒（每块 100ms）仍收不到任何能量，就判定麦克风没送进声音。 */
const SILENCE_CHUNKS_BEFORE_WARNING = 40;
/**
 * 16k 采样下正常说话的能量远高于此（约 -62 dBFS），只有静音才会更低。
 * 这是「宁漏报不误报」的取舍：值设得太高，选错输入设备带轻微底噪时首块就超阈值，
 * 静音判定永不触发、回到无声失败；设得太低又可能把真话误判成静音。
 */
const SILENCE_RMS_THRESHOLD = 0.0008;

const INITIAL_STATUS: SpeechInputStatus = {
	supported: false,
	phase: "unsupported",
	modelId: "",
};

export function useSpeechInput(enabled: boolean): SpeechInputModel {
	const { t } = useTranslation("chat");
	const buildEnabled = isSpeechInputBuildEnabled();
	const [status, setStatus] = useState<SpeechInputStatus>(INITIAL_STATUS);
	const captureRef = useRef<MicrophonePcmCapture | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const busyRef = useRef(false);
	/**
	 * 静音探测：录音期间累计块数与最大能量。
	 *
	 * 麦克风被系统拒绝、选错输入设备或被别的程序独占时，`getUserMedia` 仍会返回一条
	 * 静音轨道——不报错、状态照常 listening，识别器拿到的全是 0，界面表现就是「点了录音
	 * 但一个字都不出来」。这里自己看能量，超过阈值时间仍全静音就明确报错。
	 */
	const silenceRef = useRef({ chunks: 0, maxRms: 0, warned: false });

	useEffect(() => {
		if (!buildEnabled || !isSpeechInputPlatform) return;
		let active = true;
		const unsubscribe = window.astravia.speechInput.onEvent((event) => {
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
		void window.astravia.speechInput.getStatus().then((next) => {
			if (active) setStatus(next);
		});
		return () => {
			active = false;
			unsubscribe();
			void captureRef.current?.stop();
			if (sessionIdRef.current) void window.astravia.speechInput.cancel(sessionIdRef.current);
			clearSpeechText();
		};
	}, [buildEnabled]);

	const errorText = useCallback(
		(code?: SpeechInputErrorCode): string => {
			switch (code) {
				case "bundled-model-invalid":
					return t("inputBar.speech.errors.integrity");
				case "bundled-model-missing":
					return t("inputBar.speech.errors.missing");
				case "unsupported-platform":
					return t("inputBar.speech.errors.unsupported");
				case "microphone-denied":
					return t("inputBar.speech.errors.microphone");
				case "microphone-silent":
					return t("inputBar.speech.errors.silent");
				default:
					return t("inputBar.speech.errors.recognizer");
			}
		},
		[t],
	);

	const stop = useCallback(async (): Promise<void> => {
		const sessionId = sessionIdRef.current;
		sessionIdRef.current = null;
		const capture = captureRef.current;
		captureRef.current = null;
		await capture?.stop();
		if (sessionId) await window.astravia.speechInput.stop(sessionId);
		clearSpeechText();
	}, []);

	const toggle = useCallback(async (): Promise<void> => {
		if (!buildEnabled || !enabled || !isSpeechInputPlatform) return;
		if (busyRef.current) return;
		busyRef.current = true;
		try {
			if (sessionIdRef.current) {
				await stop();
				return;
			}
			let readyStatus = status;
			if (status.phase === "error") {
				readyStatus = await window.astravia.speechInput.getStatus();
				setStatus(readyStatus);
			}
			if (readyStatus.phase !== "ready") {
				/*
				 * 以前这里直接 return：按钮看着能点，点下去毫无反应，用户只能猜是麦克风坏了
				 * 还是功能没做。现在把原因说出来（缺模型 / 模型损坏 / 平台不支持 / 麦克风被拒）。
				 */
				showToast({
					variant: "error",
					title: t("inputBar.speech.errors.title"),
					message: errorText(readyStatus.errorCode),
				});
				return;
			}

			const { sessionId } = await window.astravia.speechInput.start();
			sessionIdRef.current = sessionId;
			const capture = new MicrophonePcmCapture();
			captureRef.current = capture;
			silenceRef.current = { chunks: 0, maxRms: 0, warned: false };
			try {
				await capture.start((samples) => {
					const probe = silenceRef.current;
					if (probe.warned) return;
					probe.chunks += 1;
					if (probe.maxRms < SILENCE_RMS_THRESHOLD) {
						let sum = 0;
						for (const value of samples) sum += value * value;
						probe.maxRms = Math.max(probe.maxRms, Math.sqrt(sum / samples.length));
						// 够久仍然全静音：不是「还没开口」，是根本收不到声音。
						if (probe.chunks >= SILENCE_CHUNKS_BEFORE_WARNING && probe.maxRms < SILENCE_RMS_THRESHOLD) {
							// 只报一次：stop 后 worklet 可能还有一两块已在队列里，未设防会重复弹 toast。
							probe.warned = true;
							void stop();
							setStatus((current) => ({ ...current, phase: "error", errorCode: "microphone-silent" }));
							showToast({
								variant: "error",
								title: t("inputBar.speech.errors.title"),
								message: t("inputBar.speech.errors.silent"),
							});
						}
					}
					window.astravia.speechInput.pushAudio(sessionId, samples);
				});
			} catch {
				captureRef.current = null;
				sessionIdRef.current = null;
				await window.astravia.speechInput.cancel(sessionId);
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
			showToast({
				variant: "error",
				title: t("inputBar.speech.errors.title"),
				message: t("inputBar.speech.errors.recognizer"),
			});
		} finally {
			busyRef.current = false;
		}
	}, [buildEnabled, enabled, errorText, status, stop, t]);

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
			visible: buildEnabled && isSpeechInputPlatform,
			active: status.phase === "listening",
			/*
			 * `unavailable` 不设为禁用：禁用后点击不会触发任何反馈，用户无法知道是缺模型。
			 * 这些状态交给 toggle 弹提示说明原因。
			 */
			disabled: !enabled || status.phase === "loading" || status.phase === "stopping",
			title: titleByPhase[status.phase],
			statusText,
			onToggle: () => void toggle(),
		};
	}, [buildEnabled, enabled, errorText, status, t, toggle]);
}

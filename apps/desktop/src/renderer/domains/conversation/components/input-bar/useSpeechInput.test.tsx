// @vitest-environment jsdom

import type { DesktopApi, DesktopSpeechInputApi, SpeechInputEvent, SpeechInputStatus } from "@preload/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	speechInputBuildEnabled: true,
	replaceSpeechText: vi.fn(),
	clearSpeechText: vi.fn(),
	focusInputEditor: vi.fn(),
	captureStart: vi.fn(),
	captureStop: vi.fn(),
	showToast: vi.fn(),
}));

vi.mock("@shared/lib/platform", () => ({ isSpeechInputPlatform: true }));
vi.mock("@shared/store/toast-atoms", () => ({ showToast: mocks.showToast }));
vi.mock("@/shared/feature-flags", () => ({
	isSpeechInputBuildEnabled: () => mocks.speechInputBuildEnabled,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { progress?: number }) =>
			options?.progress === undefined ? key : `${key}:${options.progress}`,
	}),
}));
vi.mock("./editor/inputEditorHandle", () => ({
	replaceSpeechText: mocks.replaceSpeechText,
	clearSpeechText: mocks.clearSpeechText,
	focusInputEditor: mocks.focusInputEditor,
}));
vi.mock("../../services/microphone-pcm-capture", () => ({
	MicrophonePcmCapture: class {
		start = mocks.captureStart;
		stop = mocks.captureStop;
	},
}));

import { useSpeechInput } from "./useSpeechInput";

const READY_STATUS: SpeechInputStatus = {
	supported: true,
	phase: "ready",
	modelId: "test-model",
};
const UNAVAILABLE_STATUS: SpeechInputStatus = {
	...READY_STATUS,
	phase: "unavailable",
	errorCode: "bundled-model-missing",
};

describe("useSpeechInput", () => {
	let emit: (event: SpeechInputEvent) => void;
	let speechInput: DesktopSpeechInputApi;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.speechInputBuildEnabled = true;
		mocks.captureStart.mockResolvedValue(undefined);
		mocks.captureStop.mockResolvedValue(undefined);
		speechInput = {
			getStatus: vi.fn(async () => READY_STATUS),
			start: vi.fn(async () => ({ sessionId: "session-1" })),
			pushAudio: vi.fn(),
			stop: vi.fn(async () => undefined),
			cancel: vi.fn(async () => undefined),
			onEvent: vi.fn((handler) => {
				emit = handler;
				return () => undefined;
			}),
		};
		Object.defineProperty(window, "astravia", {
			configurable: true,
			value: { speechInput } as unknown as DesktopApi,
		});
	});

	it("does not expose or initialize voice input in a speech-disabled build", () => {
		mocks.speechInputBuildEnabled = false;
		const { result } = renderHook(() => useSpeechInput(true));

		expect(result.current.visible).toBe(false);
		expect(speechInput.onEvent).not.toHaveBeenCalled();
		expect(speechInput.getStatus).not.toHaveBeenCalled();
		act(() => result.current.onToggle());
		expect(speechInput.start).not.toHaveBeenCalled();
	});

	it("starts with the bundled model and inserts final text", async () => {
		const { result } = renderHook(() => useSpeechInput(true));
		await waitFor(() => expect(result.current.title).toBe("inputBar.speech.actions.start"));

		act(() => result.current.onToggle());
		await waitFor(() => expect(speechInput.start).toHaveBeenCalledOnce());
		await waitFor(() => expect(mocks.captureStart).toHaveBeenCalledOnce());

		act(() => emit({ type: "partial", sessionId: "session-1", text: "你好" }));
		expect(mocks.replaceSpeechText).toHaveBeenCalledWith("你好");
		act(() => emit({ type: "final", sessionId: "session-1", text: "你好世界" }));
		expect(mocks.replaceSpeechText).toHaveBeenCalledWith("你好世界");
		expect(mocks.clearSpeechText).toHaveBeenCalledOnce();
		expect(mocks.focusInputEditor).toHaveBeenCalledOnce();
	});

	// 回归：麦克风被系统拒绝/选错设备时，getUserMedia 会返回一条静音轨道——不报错、
	// 状态照常 listening，识别器拿到的全是 0，界面表现是「点了录音但一个字都不出来」。
	// 现在按能量判定并明确报错，而不是让用户对着一个不动的按钮猜。
	it("录音期间一直是静音时，主动报错并停止", async () => {
		const { result } = renderHook(() => useSpeechInput(true));
		await waitFor(() => expect(result.current.title).toBe("inputBar.speech.actions.start"));

		let push: ((samples: Float32Array) => void) | undefined;
		mocks.captureStart.mockImplementationOnce(async (fn: (samples: Float32Array) => void) => {
			push = fn;
		});
		act(() => result.current.onToggle());
		await waitFor(() => expect(push).toBeDefined());

		// 40 块全零（约 4 秒静音）后应触发判定。
		for (let i = 0; i < 40; i += 1) {
			act(() => push?.(new Float32Array(1600)));
		}

		expect(mocks.showToast).toHaveBeenCalledWith(
			expect.objectContaining({ message: "inputBar.speech.errors.silent" }),
		);
		// stop 是异步链路（先停采集再通知主进程），断言要等它落地。
		await waitFor(() => expect(speechInput.stop).toHaveBeenCalled());
	});

	// 有真实声音时不误报：同样的块数与时长，只要有能量就不该弹静音错误。
	it("有声音时不报静音错误", async () => {
		const { result } = renderHook(() => useSpeechInput(true));
		await waitFor(() => expect(result.current.title).toBe("inputBar.speech.actions.start"));

		let push: ((samples: Float32Array) => void) | undefined;
		mocks.captureStart.mockImplementationOnce(async (fn: (samples: Float32Array) => void) => {
			push = fn;
		});
		act(() => result.current.onToggle());
		await waitFor(() => expect(push).toBeDefined());

		const loud = new Float32Array(1600).fill(0.1);
		for (let i = 0; i < 50; i += 1) act(() => push?.(loud));

		expect(mocks.showToast).not.toHaveBeenCalledWith(
			expect.objectContaining({ message: "inputBar.speech.errors.silent" }),
		);
	});

	// 回归：缺模型时按钮此前被设为禁用。禁用后点击不会触发任何回调，用户点它毫无反应，
	// 分不清是麦克风坏了还是功能没做。现在保持可点，由 toggle 弹出缺失原因。
	it("keeps voice input clickable when the packaged model is unavailable, and reports why", async () => {
		vi.mocked(speechInput.getStatus).mockResolvedValue(UNAVAILABLE_STATUS);
		const { result } = renderHook(() => useSpeechInput(true));

		await waitFor(() => expect(result.current.statusText).toBe("inputBar.speech.errors.missing"));
		expect(result.current.disabled).toBe(false);
		act(() => result.current.onToggle());
		expect(mocks.showToast).toHaveBeenCalledWith(
			expect.objectContaining({ message: "inputBar.speech.errors.missing" }),
		);
		expect(speechInput.start).not.toHaveBeenCalled();
	});
});

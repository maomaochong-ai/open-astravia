// @vitest-environment jsdom

import type { DesktopApi, DesktopSpeechInputApi, SpeechInputEvent, SpeechInputStatus } from "@preload/api";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	insertPlainText: vi.fn(),
	focusInputEditor: vi.fn(),
	captureStart: vi.fn(),
	captureStop: vi.fn(),
}));

vi.mock("@shared/lib/platform", () => ({ isWindows: true }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { progress?: number }) =>
			options?.progress === undefined ? key : `${key}:${options.progress}`,
	}),
}));
vi.mock("./editor/inputEditorHandle", () => ({
	insertPlainText: mocks.insertPlainText,
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
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { speechInput } as unknown as DesktopApi,
		});
	});

	it("starts with the bundled model and inserts final text", async () => {
		const { result } = renderHook(() => useSpeechInput(true));
		await waitFor(() => expect(result.current.title).toBe("inputBar.speech.actions.start"));

		act(() => result.current.onToggle());
		await waitFor(() => expect(speechInput.start).toHaveBeenCalledOnce());
		await waitFor(() => expect(mocks.captureStart).toHaveBeenCalledOnce());

		act(() => emit({ type: "partial", sessionId: "session-1", text: "你好" }));
		expect(result.current.statusText).toBe("你好");
		act(() => emit({ type: "final", sessionId: "session-1", text: "你好世界" }));
		expect(mocks.insertPlainText).toHaveBeenCalledWith("你好世界");
		expect(mocks.focusInputEditor).toHaveBeenCalledOnce();
	});

	it("disables voice input when the packaged model is unavailable", async () => {
		vi.mocked(speechInput.getStatus).mockResolvedValue(UNAVAILABLE_STATUS);
		const { result } = renderHook(() => useSpeechInput(true));

		await waitFor(() => expect(result.current.disabled).toBe(true));
		expect(result.current.statusText).toBe("inputBar.speech.errors.missing");
		act(() => result.current.onToggle());
		expect(speechInput.start).not.toHaveBeenCalled();
	});
});

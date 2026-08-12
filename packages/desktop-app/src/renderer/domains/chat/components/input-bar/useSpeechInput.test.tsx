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

const MISSING_STATUS: SpeechInputStatus = {
	supported: true,
	phase: "missing-model",
	modelId: "test-model",
	downloadedBytes: 0,
	totalBytes: 100,
};
const READY_STATUS: SpeechInputStatus = { ...MISSING_STATUS, phase: "ready", downloadedBytes: 100 };

describe("useSpeechInput", () => {
	let emit: (event: SpeechInputEvent) => void;
	let speechInput: DesktopSpeechInputApi;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.captureStart.mockResolvedValue(undefined);
		mocks.captureStop.mockResolvedValue(undefined);
		speechInput = {
			getStatus: vi.fn(async () => MISSING_STATUS),
			downloadModel: vi.fn(async () => READY_STATUS),
			cancelDownload: vi.fn(async () => undefined),
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

	it("downloads on first use, starts capture, and inserts final text", async () => {
		const { result } = renderHook(() => useSpeechInput(true));
		await waitFor(() => expect(result.current.title).toBe("inputBar.speech.actions.downloadAndStart"));

		act(() => result.current.onToggle());
		await waitFor(() => expect(speechInput.downloadModel).toHaveBeenCalledOnce());
		await waitFor(() => expect(speechInput.start).toHaveBeenCalledOnce());
		await waitFor(() => expect(mocks.captureStart).toHaveBeenCalledOnce());

		act(() => emit({ type: "partial", sessionId: "session-1", text: "你好" }));
		expect(result.current.statusText).toBe("你好");
		act(() => emit({ type: "final", sessionId: "session-1", text: "你好世界" }));
		expect(mocks.insertPlainText).toHaveBeenCalledWith("你好世界");
		expect(mocks.focusInputEditor).toHaveBeenCalledOnce();
	});
});

import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.resetModules();
});

it("subscribes through the renderer bridge, samples the real host, then stops capture and polling", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	vi.spyOn(console, "info").mockImplementation(() => undefined);
	vi.spyOn(console, "debug").mockImplementation(() => undefined);
	const track = { kind: "video", stop: vi.fn(), getSettings: () => ({ width: 2560, height: 1600 }) };
	const capture = vi.fn(async () => ({ getVideoTracks: () => [track] }));
	vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: capture } });
	const sender = {
		track: null as MediaStreamTrack | null,
		parameters: { encodings: [{}] } as RTCRtpSendParameters,
		getParameters: () => structuredClone(sender.parameters),
		setParameters: async (parameters: RTCRtpSendParameters) => {
			sender.parameters = parameters;
		},
		replaceTrack: async (next: MediaStreamTrack | null) => {
			sender.track = next;
		},
	};
	const getStats = vi.fn(
		async () =>
			new Map<string, Record<string, unknown>>([
				[
					"out",
					{
						id: "out",
						type: "outbound-rtp",
						kind: "video",
						timestamp: Date.now(),
						framesEncoded: Date.now() * 0.03,
						totalEncodeTime: Date.now() * 0.0003,
						framesPerSecond: 30,
						qualityLimitationReason: "none",
					},
				],
			]),
	);
	vi.stubGlobal(
		"RTCPeerConnection",
		class {
			addTransceiver() {
				return { sender };
			}
			createDataChannel() {
				return { readyState: "connecting" };
			}
			getStats = getStats;
		},
	);
	vi.stubGlobal(
		"WebSocket",
		class {
			onopen: (() => void) | null = null;
			constructor() {
				void Promise.resolve().then(() => this.onopen?.());
			}
		},
	);
	let screen: ((request: { id: number; active: boolean }) => void) | undefined;
	const screenResult = vi.fn();
	const page = Object.assign(new EventTarget(), {
		location: {
			search: "?target=ws%3A%2F%2Ftest.invalid&sessionId=pairing_0123456789abcdefghijklmnop&screen=demand",
		},
		vettaRemoteDesktop: {
			onControlSend: () => () => undefined,
			onScreen: (callback: typeof screen) => {
				screen = callback;
				return () => undefined;
			},
			screenReady: vi.fn(),
			screenResult,
		},
	});
	vi.stubGlobal("window", page);
	await import("./remote-desktop-host.js");
	expect(capture).not.toHaveBeenCalled();
	screen?.({ id: 1, active: true });
	await vi.waitFor(() => expect(screenResult).toHaveBeenCalledWith(1, true));
	expect(capture).toHaveBeenCalledWith(
		expect.objectContaining({ video: expect.objectContaining({ frameRate: { max: 30 } }) }),
	);
	expect(sender.parameters).toMatchObject({
		degradationPreference: "maintain-framerate",
		encodings: [{ maxFramerate: 30 }],
	});
	await vi.advanceTimersByTimeAsync(2200);
	expect(getStats).toHaveBeenCalledTimes(2);
	screen?.({ id: 2, active: false });
	await vi.waitFor(() => expect(screenResult).toHaveBeenCalledWith(2, false));
	expect(track.stop).toHaveBeenCalledOnce();
	expect(sender.track).toBeNull();
	await vi.advanceTimersByTimeAsync(5000);
	expect(getStats).toHaveBeenCalledTimes(2);
	page.dispatchEvent(new Event("beforeunload"));
});

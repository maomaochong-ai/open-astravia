import { describe, expect, it, vi } from "vitest";
import { REMOTE_DESKTOP_ICE_SERVERS, RemoteDesktopHost } from "../src/index.js";

describe("remote desktop ICE servers", () => {
	it("uses STUN only, and no server a proxy would carry", () => {
		const urls = REMOTE_DESKTOP_ICE_SERVERS.flatMap((server) => [server.urls].flat());
		expect(urls.length).toBeGreaterThan(1);
		expect(urls.every((url) => url.startsWith("stun:"))).toBe(true);
		expect(REMOTE_DESKTOP_ICE_SERVERS.some((server) => server.credential !== undefined)).toBe(false);
		expect(urls.filter((url) => /google|cloudflare/.test(url))).toEqual([]);
	});
});

describe("remote desktop host negotiation", () => {
	it.each(["failed", "closed"] as const)(
		"releases control when the peer becomes %s before its data channel closes",
		async (state) => {
			const peer = fakePeerConnection();
			const closed: string[] = [];
			const host = new RemoteDesktopHost(
				{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
				() => undefined,
				() => undefined,
				{ onMessage: () => undefined, onClose: (reason) => closed.push(reason ?? "") },
			);
			await host.start(undefined, { waitForPeerReady: true });
			await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
			const control = peer.channels[1];
			Object.defineProperty(control, "readyState", { value: "open", configurable: true });
			peer.setConnectionState("connected");
			host.sendControl("before interruption");
			peer.setConnectionState("disconnected");
			expect(closed).toEqual([]);
			peer.setConnectionState(state);
			expect(closed).toEqual([`peer ${state}`]);
			expect(() => host.sendControl("after interruption")).toThrow("not open");
			control.onclose?.(new Event("close"));
			expect(closed).toHaveLength(1);
			host.close();
		},
	);

	it("waits for a relay peer-ready event before sending the offer", async () => {
		const peer = fakePeerConnection();
		const sent: unknown[] = [];
		const host = new RemoteDesktopHost(
			{
				sessionId: "pairing_0123456789abcdefghijklmnop",
				createPeerConnection: () => peer.connection,
			},
			(signal) => {
				sent.push(signal);
			},
			() => undefined,
		);

		await host.start(fakeStream(), { waitForPeerReady: true });
		expect(peer.createOffer).not.toHaveBeenCalled();
		expect(sent).toEqual([]);

		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });

		expect(peer.createOffer).toHaveBeenCalledOnce();
		expect(sent).toEqual([
			{
				type: "offer",
				protocolVersion: 1,
				sessionId: "pairing_0123456789abcdefghijklmnop",
				sdp: "v=0\r\n",
			},
		]);

		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
	});

	it("starts over when a new viewer comes online after the host already offered", async () => {
		const peer = fakePeerConnection();
		const replaced = vi.fn();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start(undefined, { waitForPeerReady: true, onViewerReplaced: replaced });
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(peer.createOffer).toHaveBeenCalledOnce();
		expect(replaced).not.toHaveBeenCalled();

		// The first viewer never answered, and another one arrives.
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(replaced).toHaveBeenCalledOnce();
		expect(peer.createOffer).toHaveBeenCalledOnce();
	});

	it("keeps a connected viewer that rejoins signaling, and starts over only if the connection then drops", async () => {
		const peer = fakePeerConnection();
		const replaced = vi.fn();
		const states: string[] = [];
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start(undefined, {
			waitForPeerReady: true,
			onViewerReplaced: replaced,
			onConnectionStateChange: (state) => states.push(state),
		});
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		peer.setConnectionState("connected");

		// The relay restarted and the phone's signaling came back; the direct link stayed up.
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(replaced).not.toHaveBeenCalled();
		expect(peer.createOffer).toHaveBeenCalledOnce();

		// It was a new viewer after all: the old one's connection goes away.
		peer.setConnectionState("failed");
		expect(replaced).toHaveBeenCalledOnce();
		expect(states).toEqual(["connected", "failed"]);
	});

	it("rides out a brief disconnect of a rejoined viewer, and starts over once it lasts", async () => {
		vi.useFakeTimers();
		try {
			const peer = fakePeerConnection();
			const replaced = vi.fn();
			const host = new RemoteDesktopHost(
				{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
				() => undefined,
				() => undefined,
			);
			await host.start(undefined, { waitForPeerReady: true, onViewerReplaced: replaced });
			await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
			peer.setConnectionState("connected");
			await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });

			// A network blip: ICE recovers on its own.
			peer.setConnectionState("disconnected");
			await vi.advanceTimersByTimeAsync(3_000);
			peer.setConnectionState("connected");
			await vi.advanceTimersByTimeAsync(10_000);
			expect(replaced).not.toHaveBeenCalled();

			// Gone for good this time.
			peer.setConnectionState("disconnected");
			await vi.advanceTimersByTimeAsync(4_900);
			expect(replaced).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(200);
			expect(replaced).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("takes a phone's H.264 answer as baseline for the hardware encoder, starting the estimate high", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start(undefined, { waitForPeerReady: true });
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });

		await host.acceptSignal({
			type: "answer",
			protocolVersion: 1,
			sessionId: "pairing_0123456789abcdefghijklmnop",
			sdp: [
				"v=0",
				"a=rtpmap:108 H264/90000",
				"a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
				"a=rtpmap:127 H264/90000",
				"a=fmtp:127 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f",
				"a=rtpmap:109 rtx/90000",
				"a=fmtp:109 apt=108",
				"",
			].join("\r\n"),
		});

		expect(peer.setRemoteDescription).toHaveBeenCalledWith({
			type: "answer",
			sdp: [
				"v=0",
				"a=rtpmap:108 H264/90000",
				"a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f;x-google-start-bitrate=4000",
				"a=rtpmap:127 H264/90000",
				"a=fmtp:127 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f;x-google-start-bitrate=4000",
				"a=rtpmap:109 rtx/90000",
				"a=fmtp:109 apt=108",
				"",
			].join("\r\n"),
		});
	});

	it("opens a reliable control channel and forwards only text payloads", async () => {
		const peer = fakePeerConnection();
		const messages: string[] = [];
		const opened = vi.fn();
		const closed = vi.fn();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
			{ onOpen: opened, onMessage: (message) => messages.push(message), onClose: closed },
		);

		await host.start(fakeStream(), { waitForPeerReady: true });
		expect(peer.createDataChannel).toHaveBeenNthCalledWith(1, "vetta-input-v1", { ordered: true });
		expect(peer.createDataChannel).toHaveBeenNthCalledWith(2, "vetta-control-v2", { ordered: true });
		expect(peer.createDataChannel).toHaveBeenNthCalledWith(3, "vetta-view-v1", { ordered: true });
		const control = peer.channels[1];
		control.onopen?.(new Event("open"));
		expect(opened).toHaveBeenCalledOnce();
		control.onmessage?.({ data: '{"type":"hello"}' } as MessageEvent);
		expect(messages).toEqual(['{"type":"hello"}']);

		Object.defineProperty(control, "readyState", { value: "open", configurable: true });
		host.sendControl("sealed");
		expect(control.send).toHaveBeenCalledWith("sealed");

		control.onmessage?.({ data: new ArrayBuffer(1) } as MessageEvent);
		expect(control.close).toHaveBeenCalledOnce();
	});
});

describe("remote desktop host screen on demand", () => {
	it("ignores a pending statistics read from an unsubscribed screen after reopening", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start();
		await host.replaceScreen({
			...fakeTrack(),
			getSettings: () => ({ width: 2560, height: 1600 }),
		} as unknown as MediaStreamTrack);
		let finish: (stats: RTCStatsReport) => void = () => undefined;
		peer.setStats(
			new Promise<RTCStatsReport>((resolve) => {
				finish = resolve;
			}),
		);
		const reading = host.sampleScreen();
		await host.replaceScreen(null);
		await host.replaceScreen({
			...fakeTrack(),
			getSettings: () => ({ width: 2560, height: 1600 }),
		} as unknown as MediaStreamTrack);
		finish(
			new Map([
				[
					"old",
					{ id: "old", type: "outbound-rtp", kind: "video", timestamp: 1000, encoderImplementation: "OpenH264" },
				],
			]) as unknown as RTCStatsReport,
		);
		expect(await reading).toBeUndefined();
		expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 1 }] });
		host.close();
	});
	it("keeps control through viewing, zoom, overload, recovery and re-subscription", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
			{ onMessage: () => undefined },
		);
		await host.start();
		const track = {
			...fakeTrack(),
			kind: "video",
			getSettings: () => ({ width: 2560, height: 1600 }),
		} as unknown as MediaStreamTrack;
		await host.replaceScreen(track);
		Object.defineProperty(peer.channels[1], "readyState", { value: "open" });
		host.sendControl("viewing");
		peer.channels[2].onmessage?.({ data: '{"width":1440,"height":900}' } as MessageEvent);
		await vi.waitFor(() =>
			expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 2560 / 1706 }] }),
		);
		peer.channels[2].onmessage?.({ data: '{"width":3000,"height":1875}' } as MessageEvent);
		let frames = 0;
		let encode = 0;
		for (let second = 0; second <= 16; second++) {
			const overloaded = second <= 3;
			frames += overloaded ? 4 : 30;
			encode += overloaded ? 0.12 : 0.3;
			peer.setStats(
				new Map([
					[
						"out",
						{
							id: "out",
							type: "outbound-rtp",
							kind: "video",
							timestamp: second * 1000,
							framesEncoded: frames,
							totalEncodeTime: encode,
							framesPerSecond: overloaded ? 4 : 30,
							encoderImplementation: "OpenH264",
							mediaSourceId: "source",
							qualityLimitationReason: overloaded ? "bandwidth" : "none",
						},
					],
					["source", { id: "source", framesPerSecond: 30 }],
				]) as unknown as RTCStatsReport,
			);
			await host.sampleScreen();
			if (second === 3)
				expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 2560 / 1526 }] });
		}
		expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 2560 / 1910 }] });
		host.sendControl("recovered");
		await host.replaceScreen(null);
		expect(track.stop).toHaveBeenCalledOnce();
		await host.replaceScreen({ ...fakeTrack(), kind: "video" } as unknown as MediaStreamTrack);
		host.sendControl("reopened");
		expect(peer.channels[1].send).toHaveBeenLastCalledWith("reopened");
		expect(peer.createOffer).toHaveBeenCalledOnce();
		host.close();
	});

	it("serializes zoom writes, coalesces duplicate sizes and retries rejected parameters", async () => {
		const peer = fakePeerConnection();
		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection, logger },
			() => undefined,
			() => undefined,
		);
		await host.start();
		await host.replaceScreen({
			...fakeTrack(),
			kind: "video",
			getSettings: () => ({ width: 2560, height: 1600 }),
		} as unknown as MediaStreamTrack);
		let finish: () => void = () => undefined;
		peer.sender.setParameters.mockImplementationOnce(
			(next: Record<string, unknown>) =>
				new Promise<void>((resolve) => {
					finish = () => {
						peer.sender.parameters = next;
						resolve();
					};
				}),
		);
		const view = peer.channels[1];
		view.onmessage?.({ data: '{"width":640,"height":400}' } as MessageEvent);
		await Promise.resolve();
		const pendingCalls = peer.sender.setParameters.mock.calls.length;
		view.onmessage?.({ data: '{"width":4320,"height":2700}' } as MessageEvent);
		view.onmessage?.({ data: '{"width":4320,"height":2700}' } as MessageEvent);
		await Promise.resolve();
		expect(peer.sender.setParameters.mock.calls).toHaveLength(pendingCalls);
		finish();
		await vi.waitFor(() =>
			expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 1 }] }),
		);
		expect(peer.sender.setParameters.mock.calls).toHaveLength(pendingCalls + 1);
		peer.sender.setParameters.mockRejectedValueOnce(
			new DOMException("stale transaction", "InvalidModificationError"),
		);
		await host.noteEncoder("OpenH264");
		expect(logger.warn).toHaveBeenCalledWith(
			"remote desktop video parameters rejected",
			expect.objectContaining({ error: "InvalidModificationError" }),
		);
		await host.noteEncoder("OpenH264");
		expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 2560 / 1910 }] });
		host.close();
	});

	it("discards late stats and releases a track when closing during replacement", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start();
		let finish: () => void = () => undefined;
		peer.sender.replaceTrack.mockImplementationOnce(
			(track: MediaStreamTrack) =>
				new Promise<void>((resolve) => {
					finish = () => {
						peer.sender.track = track;
						resolve();
					};
				}),
		);
		const track = fakeTrack();
		const replacing = host.replaceScreen(track);
		await Promise.resolve();
		host.close();
		finish();
		await replacing;
		expect(track.stop).toHaveBeenCalledOnce();
		expect(peer.sender.setParameters).not.toHaveBeenCalled();
		expect(await host.sampleScreen()).toBeUndefined();
	});

	it("opens with an empty video slot and swaps the screen in and out without renegotiating", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);

		await host.start(undefined, { waitForPeerReady: true });
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(peer.addTransceiver).toHaveBeenCalledWith("video", { direction: "sendonly" });
		expect(peer.setCodecPreferences).not.toHaveBeenCalled(); // no codec list outside a browser
		expect(peer.connection.addTrack).not.toHaveBeenCalled();
		expect(peer.sender.track).toBeNull();

		const first = fakeTrack();
		await host.replaceScreen(first);
		expect(peer.sender.track).toBe(first);
		expect(first.contentHint).toBe("detail");
		expect(peer.sender.parameters).toMatchObject({
			degradationPreference: "maintain-framerate",
			encodings: [{ maxBitrate: 12_000_000, maxFramerate: 30 }],
		});

		const second = fakeTrack();
		await host.replaceScreen(second);
		expect(first.stop).toHaveBeenCalledOnce();
		expect(peer.sender.track).toBe(second);

		await host.replaceScreen(null);
		expect(second.stop).toHaveBeenCalledOnce();
		expect(peer.sender.track).toBeNull();
		expect(peer.createOffer).toHaveBeenCalledOnce();
	});

	it("sends the screen smaller while Chromium encodes it in software, and full size once hardware is back", async () => {
		const peer = fakePeerConnection();
		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection, logger },
			() => undefined,
			() => undefined,
		);
		await host.start();
		const track = { ...fakeTrack(), kind: "video", getSettings: () => ({ width: 2560, height: 1600 }) };
		await host.replaceScreen(track as unknown as MediaStreamTrack);
		expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 1 }] });

		await host.noteEncoder("OpenH264");
		expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 2560 / 1910 }] });
		expect(logger.info).toHaveBeenCalledWith(
			"remote desktop encoder changed",
			expect.objectContaining({ software: true }),
		);

		const calls = peer.sender.setParameters.mock.calls.length;
		await host.noteEncoder("OpenH264");
		expect(peer.sender.setParameters.mock.calls.length).toBe(calls);

		await host.noteEncoder("MediaFoundationVideoEncodeAccelerator");
		expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 1 }] });
	});

	it("sends the screen no larger than the phone says it shows it", async () => {
		const peer = fakePeerConnection();
		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection, logger },
			() => undefined,
			() => undefined,
		);
		await host.start();
		const track = { ...fakeTrack(), kind: "video", getSettings: () => ({ width: 2560, height: 1600 }) };
		await host.replaceScreen(track as unknown as MediaStreamTrack);
		const view = peer.channels[1];

		view.onmessage?.({ data: '{"width":1440,"height":900}' } as MessageEvent);
		await vi.waitFor(() =>
			expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 2560 / 1706 }] }),
		);

		// Zoomed in: full size again.
		view.onmessage?.({ data: '{"width":4320,"height":2700}' } as MessageEvent);
		await vi.waitFor(() =>
			expect(peer.sender.parameters).toMatchObject({ encodings: [{ scaleResolutionDownBy: 1 }] }),
		);

		const calls = peer.sender.setParameters.mock.calls.length;
		view.onmessage?.({ data: '{"width":-1}' } as MessageEvent);
		expect(logger.warn).toHaveBeenCalledWith("remote desktop invalid view rejected", expect.anything());
		expect(peer.sender.setParameters.mock.calls.length).toBe(calls);
	});

	it("refuses to swap the screen of a session started with a fixed stream", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start(fakeStream());
		await expect(host.replaceScreen(fakeTrack())).rejects.toThrow("fixed screen stream");
	});

	it("stops a track handed to a closed session instead of leaking the capture", async () => {
		const peer = fakePeerConnection();
		const host = new RemoteDesktopHost(
			{ sessionId: "pairing_0123456789abcdefghijklmnop", createPeerConnection: () => peer.connection },
			() => undefined,
			() => undefined,
		);
		await host.start();
		host.close();
		const late = fakeTrack();
		await host.replaceScreen(late);
		expect(late.stop).toHaveBeenCalledOnce();
	});
});

function fakeTrack(): MediaStreamTrack & { readonly stop: ReturnType<typeof vi.fn> } {
	return { stop: vi.fn() } as unknown as MediaStreamTrack & { readonly stop: ReturnType<typeof vi.fn> };
}

function fakePeerConnection(): {
	readonly connection: RTCPeerConnection;
	readonly createOffer: ReturnType<typeof vi.fn>;
	readonly createDataChannel: ReturnType<typeof vi.fn>;
	readonly channels: RTCDataChannel[];
	readonly addTransceiver: ReturnType<typeof vi.fn>;
	readonly setCodecPreferences: ReturnType<typeof vi.fn>;
	readonly setRemoteDescription: ReturnType<typeof vi.fn>;
	readonly sender: {
		track: MediaStreamTrack | null;
		parameters: Record<string, unknown>;
		readonly setParameters: ReturnType<typeof vi.fn>;
		readonly replaceTrack: ReturnType<typeof vi.fn>;
	};
	readonly setConnectionState: (state: RTCPeerConnectionState) => void;
	readonly setStats: (stats: RTCStatsReport | Promise<RTCStatsReport>) => void;
} {
	const createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "v=0\r\n" }));
	const channels: RTCDataChannel[] = [];
	const createDataChannel = vi.fn(() => {
		const channel = {
			close: vi.fn(),
			onclose: null,
			onerror: null,
			onmessage: null,
			onopen: null,
			readyState: "connecting",
			send: vi.fn(),
		} as unknown as RTCDataChannel;
		channels.push(channel);
		return channel;
	});
	const sender = {
		track: null as MediaStreamTrack | null,
		parameters: { encodings: [{}] } as Record<string, unknown>,
		getParameters: vi.fn(() => structuredClone(sender.parameters)),
		setParameters: vi.fn(async (next: Record<string, unknown>) => {
			sender.parameters = next;
		}),
		replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
			sender.track = track;
		}),
	};
	const setCodecPreferences = vi.fn();
	const setRemoteDescription = vi.fn(async () => undefined);
	const addTransceiver = vi.fn(() => ({ sender, setCodecPreferences }));
	let stats: RTCStatsReport | Promise<RTCStatsReport> = new Map() as unknown as RTCStatsReport;
	const connection = {
		addTransceiver,
		addIceCandidate: vi.fn(async () => undefined),
		addTrack: vi.fn((track: MediaStreamTrack) => {
			sender.track = track;
			return sender;
		}),
		getStats: vi.fn(async () => stats),
		close: vi.fn(),
		connectionState: "new",
		createDataChannel,
		createOffer,
		getSenders: vi.fn(() => []),
		onconnectionstatechange: null,
		onicecandidate: null,
		remoteDescription: null,
		setLocalDescription: vi.fn(async () => undefined),
		setRemoteDescription,
		signalingState: "stable",
	} as unknown as RTCPeerConnection;
	return {
		connection,
		createOffer,
		createDataChannel,
		channels,
		addTransceiver,
		sender,
		setCodecPreferences,
		setRemoteDescription,
		setConnectionState(state) {
			(connection as { connectionState: RTCPeerConnectionState }).connectionState = state;
			connection.onconnectionstatechange?.(new Event("connectionstatechange"));
		},
		setStats(value) {
			stats = value;
		},
	};
}

function fakeStream(): MediaStream {
	const track = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
	return {
		getTracks: () => [track],
		getVideoTracks: () => [track],
	} as unknown as MediaStream;
}

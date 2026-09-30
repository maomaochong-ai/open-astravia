import type { RemoteDesktopSignal } from "@vetta/remote-desktop";
import { RemoteDesktopHost, WebSocketRemoteDesktopSignaling } from "@vetta/remote-desktop";

declare global {
	interface Window {
		vettaRemoteDesktop?: {
			onInput(message: unknown): void;
			onControlOpen(): void;
			onControlMessage(message: string): void;
			onControlClose(reason?: string): void;
			onControlSend(callback: (message: string) => void): () => void;
			onScreen(callback: (request: { id: number; active: boolean }) => void): () => void;
			screenReady(): void;
			screenResult(id: number, streaming: boolean): void;
		};
	}
}

const params = new URLSearchParams(window.location.search);
const target = params.get("target");
const sessionId = params.get("sessionId");
if (!target || !sessionId) throw new Error("remote desktop host target is missing");
// "demand": capture only while a phone subscribes (ADR-0140); otherwise for the whole session.
const onDemand = params.get("screen") === "demand";
// Sharp enough to read zoomed-in text, small enough for the hardware encoder to keep up at
// full frame rate, so dragging stays smooth.
const SCREEN_CAPTURE: DisplayMediaStreamOptions = {
	video: { width: { max: 2560 }, height: { max: 1600 }, frameRate: { max: 60 } },
	audio: false,
};

// While the screen is shared, how it is being sent: codec, encoder, frame rate, size and
// what holds it back. Counts and names only (packages/remote-desktop/AGENTS.md).
let statsTimer: ReturnType<typeof setInterval> | undefined;
const logStats = async (): Promise<void> => {
	const current = host;
	if (!current) return;
	const reports = new Map<string, Record<string, unknown>>();
	(await current.getStats()).forEach((report: Record<string, unknown>) => {
		reports.set(String(report.id), report);
	});
	for (const report of reports.values()) {
		if (report.type !== "outbound-rtp" || report.kind !== "video") continue;
		const pair = [...reports.values()].find((entry) => entry.type === "candidate-pair" && entry.nominated === true);
		console.info(
			line("remote desktop stream", {
				codec: typeof report.codecId === "string" ? reports.get(report.codecId)?.mimeType : undefined,
				encoder: report.encoderImplementation,
				framesPerSecond: report.framesPerSecond,
				width: report.frameWidth,
				height: report.frameHeight,
				limitedBy: report.qualityLimitationReason,
				roundTripMs:
					typeof pair?.currentRoundTripTime === "number"
						? Math.round(pair.currentRoundTripTime * 1000)
						: undefined,
			}),
		);
	}
};
const watchStats = (streaming: boolean): void => {
	if (statsTimer) clearInterval(statsTimer);
	statsTimer = streaming ? setInterval(() => void logStats().catch(() => undefined), 5_000) : undefined;
};

const signaling = new WebSocketRemoteDesktopSignaling(target);
let host: RemoteDesktopHost | undefined;
const pending: RemoteDesktopSignal[] = [];

// Starting over drops the peer connection and the page's state; the new page reconnects
// signaling and offers again once the phone is there.
let restarting = false;
const restart = (reason: string, delayMs = 1_000): void => {
	if (restarting) return;
	restarting = true;
	console.warn(line("remote desktop host restarting", { reason }));
	setTimeout(() => window.location.reload(), delayMs);
};

// Once the phone is connected directly, signaling is only needed to negotiate again: the
// relay can restart or drop the socket and the screen, input and control keep flowing.
// Signaling comes back in the background; before that point a drop starts over as before.
const SIGNALING_RETRY_MAX_MS = 30_000;
let signalingRetryMs = 1_000;
let signalingRetry: ReturnType<typeof setTimeout> | undefined;
const signalingHandlers = {
	onSignal(signal: RemoteDesktopSignal) {
		// Types only: never SDP or candidates (packages/remote-desktop/AGENTS.md).
		console.info(line("remote desktop signal received", { type: signal.type }));
		if (host) void host.acceptSignal(signal);
		else pending.push(signal);
	},
	onClose(reason?: string) {
		const state = host?.connectionState;
		console.warn(line("remote desktop signaling closed", { reason, peer: state }));
		if (state === "connected") reconnectSignaling();
		else restart("signaling closed");
	},
};
const reconnectSignaling = (): void => {
	if (signalingRetry || restarting) return;
	const delay = signalingRetryMs;
	signalingRetryMs = Math.min(signalingRetryMs * 2, SIGNALING_RETRY_MAX_MS);
	signalingRetry = setTimeout(() => {
		signalingRetry = undefined;
		signaling.connect(signalingHandlers).then(
			() => {
				signalingRetryMs = 1_000;
				console.info(line("remote desktop signaling reconnected", { peer: host?.connectionState }));
			},
			() => reconnectSignaling(),
		);
	}, delay);
};
const sendSignal = async (signal: RemoteDesktopSignal): Promise<void> => {
	// While signaling is away, late candidates have nowhere to go; the direct link does not need them.
	if (!signaling.connected) return;
	try {
		await signaling.send(signal);
	} catch (error) {
		console.warn(line("remote desktop signal not sent", { type: signal.type, error: String(error) }));
	}
};

try {
	await signaling.connect(signalingHandlers);
} catch (error) {
	// The relay may be down: try again with a fresh page, as when signaling drops.
	restart(`signaling unavailable: ${String(error)}`);
	throw error;
}

const stream = onDemand ? undefined : await navigator.mediaDevices.getDisplayMedia(SCREEN_CAPTURE);
host = new RemoteDesktopHost(
	{
		sessionId,
		logger: {
			debug: (message, fields) => console.debug(line(message, fields)),
			info: (message, fields) => console.info(line(message, fields)),
			warn: (message, fields) => console.warn(line(message, fields)),
		},
	},
	sendSignal,
	(message) => window.vettaRemoteDesktop?.onInput(message),
	{
		onOpen: () => window.vettaRemoteDesktop?.onControlOpen(),
		onMessage: (message) => window.vettaRemoteDesktop?.onControlMessage(message),
		onClose: (reason) => window.vettaRemoteDesktop?.onControlClose(reason),
	},
);
const removeControlListener = window.vettaRemoteDesktop?.onControlSend((message) => {
	try {
		host?.sendControl(message);
	} catch (error) {
		console.warn("remote desktop control send failed", error);
	}
});
await host.start(stream, {
	waitForPeerReady: true,
	// A new viewer is a new peer connection: start over with a fresh page, as when signaling drops.
	onViewerReplaced: () => restart("viewer replaced", 0),
	// With signaling away no phone can tell this page the session ended, so a connection
	// that is gone for good starts over here.
	onConnectionStateChange: (state) => {
		if ((state === "failed" || state === "closed") && !signaling.connected) restart(`peer ${state}`);
	},
});
// A screen shared for the whole session streams from the start.
if (!onDemand) watchStats(true);
for (const signal of pending.splice(0)) await host.acceptSignal(signal);

// Requests run one after another so a quick close-and-reopen cannot leave two captures.
let screenTrack: MediaStreamTrack | undefined;
let screenQueue = Promise.resolve();
const setScreen = async (active: boolean): Promise<boolean> => {
	const current = host;
	if (!current) return false;
	if (!active) {
		screenTrack = undefined;
		watchStats(false);
		await current.replaceScreen(null);
		return false;
	}
	if (screenTrack?.readyState === "live") return true;
	const track = (await navigator.mediaDevices.getDisplayMedia(SCREEN_CAPTURE)).getVideoTracks()[0];
	if (!track) return false;
	await current.replaceScreen(track);
	screenTrack = track;
	watchStats(true);
	return true;
};
const removeScreenListener = onDemand
	? window.vettaRemoteDesktop?.onScreen(({ id, active }) => {
			screenQueue = screenQueue.then(async () => {
				let streaming = false;
				try {
					streaming = await setScreen(active);
				} catch (error) {
					console.warn("remote desktop screen capture failed", error);
				}
				window.vettaRemoteDesktop?.screenResult(id, streaming);
			});
		})
	: undefined;
window.addEventListener(
	"beforeunload",
	() => {
		removeControlListener?.();
		removeScreenListener?.();
	},
	{ once: true },
);
if (onDemand) window.vettaRemoteDesktop?.screenReady();

/** The main process only sees console text, so fields go in as JSON. */
function line(message: string, fields?: unknown): string {
	return fields === undefined ? message : `${message} ${JSON.stringify(fields)}`;
}

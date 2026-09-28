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
// The display's own resolution, up to 4K: a phone zooms in to read text, so it must not be
// captured already scaled down. 30 fps is plenty for a desktop.
const SCREEN_CAPTURE: DisplayMediaStreamOptions = {
	video: { width: { max: 3840 }, height: { max: 2160 }, frameRate: { max: 30 } },
	audio: false,
};

const signaling = new WebSocketRemoteDesktopSignaling(target);
let host: RemoteDesktopHost | undefined;
const pending: RemoteDesktopSignal[] = [];

await signaling.connect({
	onSignal(signal) {
		if (host) void host.acceptSignal(signal);
		else pending.push(signal);
	},
	onClose(reason) {
		console.warn("remote desktop signaling closed", reason);
		setTimeout(() => window.location.reload(), 1_000);
	},
});

const stream = onDemand ? undefined : await navigator.mediaDevices.getDisplayMedia(SCREEN_CAPTURE);
host = new RemoteDesktopHost(
	{
		sessionId,
		logger: {
			debug: (message, fields) => console.debug(message, fields),
			info: (message, fields) => console.info(message, fields),
			warn: (message, fields) => console.warn(message, fields),
		},
	},
	async (signal) => signaling.send(signal),
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
await host.start(stream, { waitForPeerReady: true });
for (const signal of pending.splice(0)) await host.acceptSignal(signal);

// Requests run one after another so a quick close-and-reopen cannot leave two captures.
let screenTrack: MediaStreamTrack | undefined;
let screenQueue = Promise.resolve();
const setScreen = async (active: boolean): Promise<boolean> => {
	const current = host;
	if (!current) return false;
	if (!active) {
		screenTrack = undefined;
		await current.replaceScreen(null);
		return false;
	}
	if (screenTrack?.readyState === "live") return true;
	const track = (await navigator.mediaDevices.getDisplayMedia(SCREEN_CAPTURE)).getVideoTracks()[0];
	if (!track) return false;
	await current.replaceScreen(track);
	screenTrack = track;
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

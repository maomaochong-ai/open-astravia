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
		};
	}
}

const params = new URLSearchParams(window.location.search);
const target = params.get("target");
const sessionId = params.get("sessionId");
if (!target || !sessionId) throw new Error("remote desktop host target is missing");

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

const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
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
window.addEventListener("beforeunload", () => removeControlListener?.(), { once: true });
await host.start(stream, { waitForPeerReady: true });
for (const signal of pending.splice(0)) await host.acceptSignal(signal);

import type { RemoteDesktopSignal } from "@vetta/remote-desktop";
import { RemoteDesktopHost, WebSocketRemoteDesktopSignaling } from "@vetta/remote-desktop";

declare global {
	interface Window {
		vettaRemoteDesktop?: { onInput(message: unknown): void };
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
	{ sessionId },
	async (signal) => signaling.send(signal),
	(message) => window.vettaRemoteDesktop?.onInput(message),
);
await host.start(stream);
for (const signal of pending.splice(0)) await host.acceptSignal(signal);

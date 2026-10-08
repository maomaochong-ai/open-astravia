import { decodeRemoteDesktopSignal, RemoteDesktopHost } from "@vetta/remote-desktop";

const config: unknown = await (await fetch("/config")).json();
if (!config || typeof config !== "object" || !("pairingId" in config) || typeof config.pairingId !== "string")
	throw new Error("Missing fixture session");
const socket = new WebSocket(`ws://${location.host}/host`);
const send = (message: unknown) => socket.send(JSON.stringify(message));
const canvas = document.createElement("canvas");
canvas.width = 640;
canvas.height = 360;
document.body.append(canvas);
const context = canvas.getContext("2d")!;
let frame = 0;
let receivedInput = false;
// Real encoded video, with two observable colors and a moving marker. No screen capture.
setInterval(() => {
	context.fillStyle = receivedInput ? "#20bc30" : frame % 26 < 13 ? "#df3528" : "#236bdc";
	context.fillRect(0, 0, 640, 360);
	context.fillStyle = "#fff";
	context.font = "40px sans-serif";
	context.fillText(`VETTA VIDEO ${frame}`, 50, 80);
	context.fillRect((frame * 9) % 550, 150, 90, 90);
	frame++;
}, 50);

const peer = new RemoteDesktopHost(
	{ sessionId: config.pairingId },
	(signal) => send({ type: "signal", signal }),
	() => {
		receivedInput = true;
	},
	{
		onOpen() {
			send({ type: "control-open" });
		},
		onMessage(text) {
			send({ type: "control", text });
		},
		onClose() {
			send({ type: "control-close" });
		},
	},
);
let track: MediaStreamTrack | undefined;
socket.onopen = () => void peer.start(undefined, { waitForPeerReady: true });
socket.onmessage = async (event) => {
	const message: unknown = JSON.parse(event.data);
	if (!message || typeof message !== "object" || !("type" in message)) return;
	if (message.type === "signal" && "signal" in message)
		await peer.acceptSignal(decodeRemoteDesktopSignal(message.signal));
	if (message.type === "control" && "text" in message && typeof message.text === "string")
		peer.sendControl(message.text);
	if (message.type === "screen" && "active" in message && typeof message.active === "boolean") {
		receivedInput = false;
		track?.stop();
		track = message.active ? canvas.captureStream(20).getVideoTracks()[0] : undefined;
		await peer.replaceScreen(track ?? null);
	}
};
socket.onclose = () => {
	track?.stop();
	peer.close();
};

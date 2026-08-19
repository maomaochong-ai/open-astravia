import { RemoteDesktopHost, RemoteDesktopViewer } from "./index.js";
import type { RemoteDesktopSignal, RemoteInputMessage } from "./types.js";

const resultPrefix = "VETTA_E2E_RESULT:";

void run().then(
	(result) => {
		document.title = `${resultPrefix}${JSON.stringify({ ok: true, ...result })}`;
	},
	(error: unknown) => {
		document.title = `${resultPrefix}${JSON.stringify({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		})}`;
	},
);

async function run(): Promise<Record<string, number | string | boolean>> {
	const sessionId = `webrtc-e2e-${crypto.randomUUID()}`;
	const canvas = createAnimatedCanvas();
	const stream = canvas.captureStream(20);
	let viewerStream: MediaStream | undefined;
	let host: RemoteDesktopHost | undefined;
	let viewer: RemoteDesktopViewer | undefined;
	const hostQueue: RemoteDesktopSignal[] = [];
	const viewerQueue: RemoteDesktopSignal[] = [];
	let inputResolve: ((message: RemoteInputMessage) => void) | undefined;
	const receivedInput = new Promise<RemoteInputMessage>((resolve) => {
		inputResolve = resolve;
	});

	const sendToViewer = async (signal: RemoteDesktopSignal): Promise<void> => {
		if (viewer) await viewer.acceptSignal(signal);
		else viewerQueue.push(signal);
	};
	const sendToHost = async (signal: RemoteDesktopSignal): Promise<void> => {
		if (host) await host.acceptSignal(signal);
		else hostQueue.push(signal);
	};

	host = new RemoteDesktopHost({ sessionId }, sendToViewer, (message) => inputResolve?.(message));
	viewer = new RemoteDesktopViewer({ sessionId }, sendToHost, (received) => {
		viewerStream = received;
	});
	for (const signal of viewerQueue.splice(0)) await viewer.acceptSignal(signal);
	for (const signal of hostQueue.splice(0)) await host.acceptSignal(signal);
	await host.start(stream);
	await waitFor(() => host?.connectionState === "connected" && viewer?.connectionState === "connected", 10_000);
	await waitFor(() => viewerStream !== undefined, 5_000);

	const video = document.createElement("video");
	video.muted = true;
	video.autoplay = true;
	video.playsInline = true;
	video.srcObject = viewerStream ?? null;
	document.body.append(video);
	await video.play();
	await waitFor(() => video.videoWidth > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA, 5_000);
	const first = samplePixels(video);
	await delay(180);
	const second = samplePixels(video);
	const pixelDelta = absolutePixelDelta(first, second);
	const pixelEnergy = second.reduce((sum, value) => sum + value, 0);
	if (pixelEnergy < 10_000) throw new Error(`received video frame is blank (energy=${pixelEnergy})`);
	if (pixelDelta < 10_000) throw new Error(`received video frame is not moving (delta=${pixelDelta})`);

	await viewer.sendInput({ type: "pointer.move", x: 0.25, y: 0.75 });
	const input = await withTimeout(receivedInput, 5_000, "remote input was not delivered");
	if (input.type !== "pointer.move" || input.x !== 0.25 || input.y !== 0.75) {
		throw new Error("remote input payload changed in transit");
	}

	viewer.close();
	host.close();
	return {
		videoWidth: video.videoWidth,
		videoHeight: video.videoHeight,
		pixelEnergy,
		pixelDelta,
		inputDelivered: true,
	};
}

function createAnimatedCanvas(): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = 320;
	canvas.height = 180;
	document.body.append(canvas);
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("2D canvas context is unavailable");
	let frame = 0;
	const draw = (): void => {
		context.fillStyle = frame % 2 === 0 ? "#e53935" : "#43a047";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "#ffffff";
		context.fillRect((frame * 17) % 260, 45, 60, 60);
		frame += 1;
	};
	draw();
	setInterval(draw, 50);
	return canvas;
}

function samplePixels(video: HTMLVideoElement): Uint8ClampedArray {
	const canvas = document.createElement("canvas");
	canvas.width = 64;
	canvas.height = 36;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) throw new Error("sampling canvas context is unavailable");
	context.drawImage(video, 0, 0, canvas.width, canvas.height);
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function absolutePixelDelta(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
	let total = 0;
	for (let index = 0; index < left.length; index += 1) total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
	return total;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const deadline = performance.now() + timeoutMs;
	while (!predicate()) {
		if (performance.now() >= deadline) throw new Error("WebRTC E2E condition timed out");
		await delay(20);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	return await Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
	]);
}

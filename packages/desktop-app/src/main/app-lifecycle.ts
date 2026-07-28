import { type IpcMainEvent, ipcMain } from "electron";
import {
	APP_LIFECYCLE_RENDERER_BOOT_PAINTED_CHANNEL,
	APP_LIFECYCLE_RENDERER_CONTENT_PAINTED_CHANNEL,
	APP_LIFECYCLE_WHEN_READY_CHANNEL,
} from "../shared/app-lifecycle-ipc.js";

const DEFAULT_BOOT_PAINT_TIMEOUT_MS = 10_000;

function waitForPaint(
	isPainted: () => boolean,
	paintedPromise: Promise<void>,
	timeoutMs: number,
): Promise<RendererPaintResult> {
	if (isPainted()) return Promise.resolve("painted");
	return new Promise<RendererPaintResult>((resolve) => {
		const timeout = setTimeout(() => resolve("timeout"), timeoutMs);
		void paintedPromise.then(() => {
			clearTimeout(timeout);
			resolve("painted");
		});
	});
}

export type RendererPaintResult = "painted" | "timeout";

export interface AppLifecycleController {
	waitForRendererBootPaint(timeoutMs?: number): Promise<RendererPaintResult>;
	waitForRendererContentPaint(timeoutMs?: number): Promise<RendererPaintResult>;
	markReady(): void;
}

export function registerAppLifecycleIpc(): AppLifecycleController {
	let isReady = false;
	let isRendererBootPainted = false;
	let isRendererContentPainted = false;
	let resolveReady: (() => void) | undefined;
	let resolveRendererBootPainted: (() => void) | undefined;
	let resolveRendererContentPainted: (() => void) | undefined;

	const readyPromise = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});
	const rendererBootPaintedPromise = new Promise<void>((resolve) => {
		resolveRendererBootPainted = resolve;
	});
	const rendererContentPaintedPromise = new Promise<void>((resolve) => {
		resolveRendererContentPainted = resolve;
	});

	const handleRendererBootPainted = (_event: IpcMainEvent): void => {
		if (isRendererBootPainted) return;
		isRendererBootPainted = true;
		resolveRendererBootPainted?.();
	};
	const handleRendererContentPainted = (_event: IpcMainEvent): void => {
		if (isRendererContentPainted) return;
		isRendererContentPainted = true;
		resolveRendererContentPainted?.();
	};

	ipcMain.on(APP_LIFECYCLE_RENDERER_BOOT_PAINTED_CHANNEL, handleRendererBootPainted);
	ipcMain.on(APP_LIFECYCLE_RENDERER_CONTENT_PAINTED_CHANNEL, handleRendererContentPainted);
	ipcMain.handle(APP_LIFECYCLE_WHEN_READY_CHANNEL, async () => {
		await readyPromise;
	});

	return {
		waitForRendererBootPaint(timeoutMs = DEFAULT_BOOT_PAINT_TIMEOUT_MS) {
			return waitForPaint(() => isRendererBootPainted, rendererBootPaintedPromise, timeoutMs);
		},
		waitForRendererContentPaint(timeoutMs = DEFAULT_BOOT_PAINT_TIMEOUT_MS) {
			return waitForPaint(() => isRendererContentPainted, rendererContentPaintedPromise, timeoutMs);
		},
		markReady() {
			if (isReady) return;
			isReady = true;
			resolveReady?.();
		},
	};
}

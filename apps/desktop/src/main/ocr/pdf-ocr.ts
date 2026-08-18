import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

export interface OcrProgressEvent {
	page: number;
	total: number;
	phase: "text-layer" | "render" | "ocr" | "done";
}

export interface OcrPageResult {
	page: number;
	text: string;
	width: number;
	height: number;
	source: "text-layer" | "ocr";
	ocrDurationMs?: number;
	confidence?: number;
}

export interface PdfOcrInput {
	pdfPath: string;
	pages: string;
	dpi: number;
	langs: string[];
	preferTextLayer: boolean;
	textLayerMinChars: number;
	debug: boolean;
	onProgress?: (event: OcrProgressEvent) => void;
	onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export interface ImageOcrInput {
	imagePath: string;
	langs: string[];
	debug: boolean;
	onProgress?: (event: OcrProgressEvent) => void;
	onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

export interface PdfOcrResult {
	totalPages: number;
	engine: string;
	pages: OcrPageResult[];
}

const READY_CHANNEL = "vetta:ocr:ready";
const START_CHANNEL = "vetta:ocr:start";
const PROGRESS_CHANNEL = "vetta:ocr:progress";
const DONE_CHANNEL = "vetta:ocr:done";
const ERROR_CHANNEL = "vetta:ocr:error";

const IMAGE_EXT_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".gif": "image/gif",
};

function resolveRunnerEntry(): { html: string; preload: string } {
	const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
	const resDir = app.isPackaged ? appRoot : join(appRoot, "dist");
	return {
		html: join(resDir, "ocr-runner/index.html"),
		preload: join(resDir, "ocr-preload/index.js"),
	};
}

let sessionCounter = 0;

interface OcrSessionHooks {
	debug: boolean;
	onProgress?: (event: OcrProgressEvent) => void;
	onLog?: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * Spin up the hidden BrowserWindow, send the start payload once the renderer
 * signals ready, and resolve when the renderer reports done. Used by both PDF
 * and image OCR entry points so the IPC plumbing stays in one place.
 */
async function runOcrInWindow(
	hooks: OcrSessionHooks,
	buildStartPayload: (sessionId: string) => Record<string, unknown>,
	transferList: ArrayBuffer[],
): Promise<PdfOcrResult> {
	const sessionId = `ocr-${process.pid}-${++sessionCounter}`;
	const { html, preload } = resolveRunnerEntry();

	const win = new BrowserWindow({
		show: false,
		width: 1024,
		height: 1024,
		webPreferences: {
			preload,
			contextIsolation: true,
			nodeIntegration: false,
			// Trusted local content loaded via file://. Disabling webSecurity lets
			// the WASM/model fetches from sibling file:// paths bypass CORS.
			webSecurity: false,
		},
	});

	// Always surface renderer-side warnings/errors — they're a critical signal
	// when something silently fails inside ocr-web (e.g. wasm fetch, model
	// load). Info-level mirroring stays gated behind --verbose.
	win.webContents.on("console-message", (_event, level, message) => {
		const lvl: "info" | "warn" | "error" = level >= 3 ? "error" : level === 2 ? "warn" : "info";
		if (lvl !== "info" || hooks.debug) {
			hooks.onLog?.(lvl, message);
		}
	});
	win.webContents.on("did-fail-load", (_event, code, description, validatedURL) => {
		hooks.onLog?.("error", `did-fail-load ${code} ${description} ${validatedURL}`);
	});
	win.webContents.on("preload-error", (_event, preloadPath, error) => {
		hooks.onLog?.("error", `preload-error ${preloadPath}: ${error.message}`);
	});

	const cleanupHandlers: Array<() => void> = [];
	const off = () => {
		for (const h of cleanupHandlers) {
			try {
				h();
			} catch {
				// best-effort
			}
		}
	};

	try {
		const result = await new Promise<PdfOcrResult>((resolvePromise, rejectPromise) => {
			const onReady = (_event: Electron.IpcMainEvent, payload: { sessionId: string }) => {
				if (payload?.sessionId !== sessionId) return;
				const startPayload = buildStartPayload(sessionId);
				// `webContents.send` does not support an explicit transfer list; the
				// underlying IPC will copy the ArrayBuffer payload. For our largest
				// case (~13 MB scanned PDF) the copy cost is negligible vs. OCR time.
				void transferList;
				win.webContents.send(START_CHANNEL, startPayload);
			};

			const onProgress = (
				_event: Electron.IpcMainEvent,
				payload: { sessionId: string; event: OcrProgressEvent },
			) => {
				if (payload?.sessionId !== sessionId) return;
				hooks.onProgress?.(payload.event);
			};

			const onDone = (_event: Electron.IpcMainEvent, payload: { sessionId: string; result: PdfOcrResult }) => {
				if (payload?.sessionId !== sessionId) return;
				resolvePromise(payload.result);
			};

			const onError = (
				_event: Electron.IpcMainEvent,
				payload: { sessionId: string; code: string; message: string },
			) => {
				if (payload?.sessionId !== sessionId) return;
				const err = new Error(payload.message || "OCR failed");
				(err as Error & { code?: string }).code = payload.code;
				rejectPromise(err);
			};

			ipcMain.on(READY_CHANNEL, onReady);
			ipcMain.on(PROGRESS_CHANNEL, onProgress);
			ipcMain.on(DONE_CHANNEL, onDone);
			ipcMain.on(ERROR_CHANNEL, onError);
			cleanupHandlers.push(
				() => ipcMain.off(READY_CHANNEL, onReady),
				() => ipcMain.off(PROGRESS_CHANNEL, onProgress),
				() => ipcMain.off(DONE_CHANNEL, onDone),
				() => ipcMain.off(ERROR_CHANNEL, onError),
			);

			win.webContents.once("render-process-gone", (_e, details) => {
				rejectPromise(new Error(`OCR renderer crashed: ${details.reason}`));
			});

			const url = new URL(pathToFileURL(html).toString());
			url.searchParams.set("sessionId", sessionId);
			win.loadURL(url.toString()).catch(rejectPromise);
		});
		return result;
	} finally {
		off();
		if (!win.isDestroyed()) {
			win.close();
		}
	}
}

export async function runPdfOcr(input: PdfOcrInput): Promise<PdfOcrResult> {
	const pdfBytes = await readFile(input.pdfPath);
	const arrayBuffer = pdfBytes.buffer.slice(
		pdfBytes.byteOffset,
		pdfBytes.byteOffset + pdfBytes.byteLength,
	) as ArrayBuffer;

	return runOcrInWindow(
		{ debug: input.debug, onProgress: input.onProgress, onLog: input.onLog },
		(sessionId) => ({
			sessionId,
			kind: "pdf",
			pdfBytes: arrayBuffer,
			pages: input.pages,
			dpi: input.dpi,
			langs: input.langs,
			preferTextLayer: input.preferTextLayer,
			textLayerMinChars: input.textLayerMinChars,
		}),
		[arrayBuffer],
	);
}

export async function runImageOcr(input: ImageOcrInput): Promise<PdfOcrResult> {
	const imageBytes = await readFile(input.imagePath);
	const arrayBuffer = imageBytes.buffer.slice(
		imageBytes.byteOffset,
		imageBytes.byteOffset + imageBytes.byteLength,
	) as ArrayBuffer;
	const ext = extname(input.imagePath).toLowerCase();
	const mime = IMAGE_EXT_MIME[ext];
	if (!mime) {
		throw new Error(
			`Unsupported image extension "${ext || "<none>"}". Supported: ${Object.keys(IMAGE_EXT_MIME).join(", ")}`,
		);
	}

	return runOcrInWindow(
		{ debug: input.debug, onProgress: input.onProgress, onLog: input.onLog },
		(sessionId) => ({
			sessionId,
			kind: "image",
			imageBytes: arrayBuffer,
			mime,
			langs: input.langs,
		}),
		[arrayBuffer],
	);
}

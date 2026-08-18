import { contextBridge, ipcRenderer } from "electron";

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

export interface OcrPdfStartPayload {
	sessionId: string;
	kind: "pdf";
	pdfBytes: ArrayBuffer;
	pages: string;
	dpi: number;
	langs: string[];
	preferTextLayer: boolean;
	textLayerMinChars: number;
}

export interface OcrImageStartPayload {
	sessionId: string;
	kind: "image";
	imageBytes: ArrayBuffer;
	mime: string;
	langs: string[];
}

export type OcrStartPayload = OcrPdfStartPayload | OcrImageStartPayload;

export interface OcrFinalResult {
	totalPages: number;
	engine: string;
	pages: OcrPageResult[];
}

export interface OcrBridge {
	notifyReady(sessionId: string): void;
	onStart(handler: (payload: OcrStartPayload) => void): void;
	reportProgress(sessionId: string, event: OcrProgressEvent): void;
	reportDone(sessionId: string, result: OcrFinalResult): void;
	reportError(sessionId: string, code: string, message: string): void;
}

const bridge: OcrBridge = {
	notifyReady: (sessionId) => ipcRenderer.send("vetta:ocr:ready", { sessionId }),
	onStart: (handler) => {
		ipcRenderer.on("vetta:ocr:start", (_event, payload: OcrStartPayload) => {
			handler(payload);
		});
	},
	reportProgress: (sessionId, event) => ipcRenderer.send("vetta:ocr:progress", { sessionId, event }),
	reportDone: (sessionId, result) => ipcRenderer.send("vetta:ocr:done", { sessionId, result }),
	reportError: (sessionId, code, message) => ipcRenderer.send("vetta:ocr:error", { sessionId, code, message }),
};

contextBridge.exposeInMainWorld("__vettaOcr", bridge);

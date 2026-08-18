import { OcrEngine } from "@ocr-web/core";
import * as pdfjsLib from "pdfjs-dist";

interface OcrProgressEvent {
	page: number;
	total: number;
	phase: "text-layer" | "render" | "ocr" | "done";
}

interface OcrPageResult {
	page: number;
	text: string;
	width: number;
	height: number;
	source: "text-layer" | "ocr";
	ocrDurationMs?: number;
	confidence?: number;
}

interface OcrPdfStartPayload {
	sessionId: string;
	kind: "pdf";
	pdfBytes: ArrayBuffer;
	pages: string;
	dpi: number;
	langs: string[];
	preferTextLayer: boolean;
	textLayerMinChars: number;
}

interface OcrImageStartPayload {
	sessionId: string;
	kind: "image";
	imageBytes: ArrayBuffer;
	mime: string;
	langs: string[];
}

type OcrStartPayload = OcrPdfStartPayload | OcrImageStartPayload;

interface OcrFinalResult {
	totalPages: number;
	engine: string;
	pages: OcrPageResult[];
}

interface OcrBridge {
	notifyReady(sessionId: string): void;
	onStart(handler: (payload: OcrStartPayload) => void): void;
	reportProgress(sessionId: string, event: OcrProgressEvent): void;
	reportDone(sessionId: string, result: OcrFinalResult): void;
	reportError(sessionId: string, code: string, message: string): void;
}

declare global {
	interface Window {
		__vettaOcr: OcrBridge;
	}
}

// Asset paths — every dependency stays self-hosted under dist/ocr-runner/.
// Resolving via `new URL("...", import.meta.url)` keeps the paths correct
// after vite's content-hashed bundling moves the entry script around.
const ortBaseUrl = new URL("../ort/", import.meta.url).toString();
const pdfWorkerSrc = new URL("../pdf/pdf.worker.min.mjs", import.meta.url).toString();
const modelsBaseUrl = new URL("../ocr-models/", import.meta.url).toString();
const detectionUrl = `${modelsBaseUrl}ppocrv5_det.onnx`;
const recognitionUrl = `${modelsBaseUrl}ppocrv5_rec.onnx`;
const dictionaryUrl = `${modelsBaseUrl}ppocrv5_dict.txt`;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const ENGINE_NAME = "ocr-web@0.2.1+ppocrv5";

const logEl = document.getElementById("log") as HTMLDivElement;
function log(line: string): void {
	if (logEl) {
		logEl.textContent = `${logEl.textContent ?? ""}\n${line}`;
	}
	// console.log goes through Electron's `console-message` listener and is
	// only mirrored to stderr when the caller passed --verbose. Cheap to emit
	// always; the main process gates visibility.
	console.log(`[ocr] ${line}`);
}

function parsePageRange(spec: string, total: number): number[] {
	if (!spec || spec === "all") {
		return Array.from({ length: total }, (_, i) => i + 1);
	}
	const m = spec.match(/^(\d+)(?:-(\d+))?$/);
	if (!m) throw new Error(`Invalid pages spec: ${spec}`);
	const start = Math.max(1, Number(m[1]));
	const end = m[2] ? Math.min(total, Number(m[2])) : start;
	if (end < start) throw new Error(`Invalid pages spec: ${spec}`);
	const out: number[] = [];
	for (let i = start; i <= end; i++) out.push(i);
	return out;
}

// ---------------------------------------------------------------------------
// PDF text-layer extraction (preferred, near-perfect accuracy)
// ---------------------------------------------------------------------------

interface TextLayerPageResult {
	text: string;
	width: number;
	height: number;
}

async function extractTextLayer(
	pdf: pdfjsLib.PDFDocumentProxy,
	pageNum: number,
	dpi: number,
): Promise<TextLayerPageResult> {
	const page = await pdf.getPage(pageNum);
	const scale = dpi / 72;
	const viewport = page.getViewport({ scale });
	const textContent = await page.getTextContent();
	type Row = { y: number; items: { x: number; text: string }[] };
	const rows: Row[] = [];
	for (const item of textContent.items) {
		if (!("str" in item)) continue;
		const text = item.str;
		if (!text) continue;
		const x = item.transform[4] as number;
		const y = item.transform[5] as number;
		const row = rows.find((r) => Math.abs(r.y - y) < 2);
		if (row) {
			row.items.push({ x, text });
		} else {
			rows.push({ y, items: [{ x, text }] });
		}
	}
	rows.sort((a, b) => b.y - a.y);
	for (const r of rows) r.items.sort((a, b) => a.x - b.x);
	const lines = rows.map((r) => r.items.map((i) => i.text).join("")).filter((l) => l.length > 0);
	page.cleanup();
	return {
		text: lines.join("\n"),
		width: Math.ceil(viewport.width),
		height: Math.ceil(viewport.height),
	};
}

async function renderPageToCanvas(
	pdf: pdfjsLib.PDFDocumentProxy,
	pageNum: number,
	dpi: number,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
	const page = await pdf.getPage(pageNum);
	const scale = dpi / 72;
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement("canvas");
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Failed to obtain 2D context");
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	await page.render({ canvasContext: ctx, viewport }).promise;
	page.cleanup();
	return { canvas, width: canvas.width, height: canvas.height };
}

// ---------------------------------------------------------------------------
// Engine + PdfOcr lifecycle
// ---------------------------------------------------------------------------

let engineInstance: OcrEngine | null = null;
async function getEngine(): Promise<OcrEngine> {
	if (engineInstance) return engineInstance;
	log("initializing ocr-web engine (PP-OCRv5)");
	// `@ocr-web/core@>=0.2.1` accepts file:// dictionary URLs natively (the
	// earlier prefix-allowlist bug was fixed upstream). Pass the URL straight
	// through; the library handles the fetch.
	engineInstance = await OcrEngine.create({
		models: { detection: detectionUrl, recognition: recognitionUrl },
		dictionary: dictionaryUrl,
		// Electron file:// — no SharedArrayBuffer, single thread only.
		numThreads: 1,
		wasmPaths: ortBaseUrl,
		runtime: "wasm",
		onProgress: ({ loaded, total, file }) => {
			log(`load ${file}: ${(loaded / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`);
		},
	});
	return engineInstance;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function meanCtcConfidenceToScore(meanLogit: number): number {
	// Map [-2, +2] CTC mean logit to a 0..100 score for parity with the
	// previous engine's confidence column. ocr-web docs note logit > 0 ≈
	// "trustworthy"; clamp + linear approximates a comparable scale.
	return Math.round(Math.max(0, Math.min(1, (meanLogit + 2) / 4)) * 100);
}

async function recognizeCanvas(
	canvas: HTMLCanvasElement,
): Promise<{ text: string; lines: number; ocrDurationMs: number; confidence: number }> {
	const engine = await getEngine();
	const t0 = performance.now();
	const r = await engine.recognize(canvas);
	const ocrDurationMs = Math.round(performance.now() - t0);
	const meanConf = r.lines.length > 0 ? r.lines.reduce((acc, l) => acc + l.confidence, 0) / r.lines.length : 0;
	return {
		text: r.fullText.trim(),
		lines: r.lines.length,
		ocrDurationMs,
		confidence: meanCtcConfidenceToScore(meanConf),
	};
}

async function runImagePipeline(payload: OcrImageStartPayload): Promise<void> {
	const { sessionId, imageBytes, mime } = payload;
	const bridge = window.__vettaOcr;
	try {
		log(`loading image (${imageBytes.byteLength} bytes, ${mime})`);
		const blob = new Blob([imageBytes], { type: mime });
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("Failed to obtain 2D context");
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(bitmap, 0, 0);
		bitmap.close();

		bridge.reportProgress(sessionId, { page: 1, total: 1, phase: "ocr" });
		const { text, lines, ocrDurationMs, confidence } = await recognizeCanvas(canvas);
		log(`image: lines=${lines} chars=${text.length} ms=${ocrDurationMs}`);

		bridge.reportProgress(sessionId, { page: 1, total: 1, phase: "done" });
		bridge.reportDone(sessionId, {
			totalPages: 1,
			engine: ENGINE_NAME,
			pages: [
				{
					page: 1,
					text,
					width: canvas.width,
					height: canvas.height,
					source: "ocr",
					ocrDurationMs,
					confidence,
				},
			],
		});
		canvas.width = 0;
		canvas.height = 0;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(`error: ${message}`);
		bridge.reportError(sessionId, "PIPELINE_ERROR", message);
	} finally {
		if (engineInstance) {
			const e = engineInstance;
			engineInstance = null;
			await e.dispose().catch(() => {});
		}
	}
}

async function runPdfPipeline(payload: OcrPdfStartPayload): Promise<void> {
	const { sessionId, pdfBytes, pages, dpi, preferTextLayer, textLayerMinChars } = payload;
	const bridge = window.__vettaOcr;
	try {
		log(`loading PDF (${pdfBytes.byteLength} bytes)`);
		// pdfjs takes ownership of the buffer when transfer is true; we cannot
		// hand the same buffer to PdfOcr afterwards. Slice once: keep one copy
		// for the text-layer probe, hand a fresh Uint8Array (over the same
		// bytes) to PdfOcr below.
		const pdfBytesU8 = new Uint8Array(pdfBytes);
		const probeDoc = await pdfjsLib.getDocument({
			data: new Uint8Array(pdfBytesU8),
			isEvalSupported: false,
		}).promise;
		const totalPages = probeDoc.numPages;
		const wanted = parsePageRange(pages, totalPages);
		log(
			`pdf opened: total=${totalPages} processing=${wanted.length} dpi=${dpi} ` +
				`preferTextLayer=${preferTextLayer} minChars=${textLayerMinChars}`,
		);

		const results: OcrPageResult[] = [];
		const ocrTodo: { page: number; canvas: HTMLCanvasElement; width: number; height: number }[] = [];

		for (const pageNum of wanted) {
			if (preferTextLayer) {
				bridge.reportProgress(sessionId, { page: pageNum, total: wanted.length, phase: "text-layer" });
				try {
					const textLayer = await extractTextLayer(probeDoc, pageNum, dpi);
					if (textLayer.text.replace(/\s+/g, "").length >= textLayerMinChars) {
						results.push({
							page: pageNum,
							text: textLayer.text,
							width: textLayer.width,
							height: textLayer.height,
							source: "text-layer",
						});
						log(`page ${pageNum}: text-layer hit (${textLayer.text.length} chars)`);
						continue;
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					log(`page ${pageNum}: text-layer probe failed: ${msg}`);
				}
			}
			bridge.reportProgress(sessionId, { page: pageNum, total: wanted.length, phase: "render" });
			const rendered = await renderPageToCanvas(probeDoc, pageNum, dpi);
			ocrTodo.push({ page: pageNum, ...rendered });
		}

		if (ocrTodo.length > 0) {
			// We bypass `@ocr-web/pdf`'s internal PDF loader and feed canvases
			// straight to the engine. In the embedded Electron pipeline this is
			// both more diagnosable (we can inspect/persist the rendered canvas
			// if a page fails) and avoids version drift between PdfOcr's bundled
			// pdfjs and ours.
			for (let i = 0; i < ocrTodo.length; i++) {
				const { page, canvas, width, height } = ocrTodo[i];
				bridge.reportProgress(sessionId, { page, total: ocrTodo.length, phase: "ocr" });
				const { text, lines, ocrDurationMs, confidence } = await recognizeCanvas(canvas);
				log(`page ${page}: lines=${lines} chars=${text.length} ms=${ocrDurationMs}`);
				results.push({ page, text, width, height, source: "ocr", ocrDurationMs, confidence });
				canvas.width = 0;
				canvas.height = 0;
			}
		}

		await probeDoc.cleanup();
		await probeDoc.destroy();

		// Restore the user-requested order (text-layer hits were appended as we
		// went; OCR results were appended after the loop).
		results.sort((a, b) => a.page - b.page);

		bridge.reportProgress(sessionId, { page: wanted.length, total: wanted.length, phase: "done" });

		bridge.reportDone(sessionId, {
			totalPages,
			engine: ENGINE_NAME,
			pages: results,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log(`error: ${message}`);
		bridge.reportError(sessionId, "PIPELINE_ERROR", message);
	} finally {
		if (engineInstance) {
			const e = engineInstance;
			engineInstance = null;
			await e.dispose().catch(() => {});
		}
	}
}

function main(): void {
	const url = new URL(window.location.href);
	const sessionId = url.searchParams.get("sessionId");
	if (!sessionId) {
		log("missing sessionId");
		return;
	}
	const bridge = window.__vettaOcr;
	if (!bridge) {
		log("__vettaOcr bridge not exposed by preload");
		return;
	}
	bridge.onStart((payload) => {
		if (payload.kind === "image") {
			void runImagePipeline(payload);
		} else {
			void runPdfPipeline(payload);
		}
	});
	bridge.notifyReady(sessionId);
	log(`ready: ${sessionId}`);
}

main();

// Download PP-OCRv5 ONNX models for the OCR runner.
//
// `@ocr-web/models-ppocrv5` only ships URL constants pointing at jsDelivr;
// at build time we fetch the actual ONNX/dict files into resources/ocr-models/
// so the packaged app can run completely offline (Electron renderer reads
// them from the asar via file://). Idempotent: skips files already present
// with non-zero size.
//
// Override the source via env vars when needed:
//   OCR_MODELS_REPO=bent2685/ocr-web   OCR_MODELS_REF=v0.1.1

import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const projectRoot = join(import.meta.dirname, "..");
const targetDir = join(projectRoot, "resources/ocr-models");

const REPO = process.env.OCR_MODELS_REPO ?? "bent2685/ocr-web";
const REF = process.env.OCR_MODELS_REF ?? "v0.1.1";
const FILES = ["ppocrv5_det.onnx", "ppocrv5_rec.onnx", "ppocrv5_dict.txt"];

function url(filename) {
	return `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/models/${filename}`;
}

async function fileExistsAndNonEmpty(path) {
	try {
		const s = await stat(path);
		return s.isFile() && s.size > 0;
	} catch {
		return false;
	}
}

// jsDelivr 在 CI 高并发时段会偶发 502/503/504；构建不能因此随机失败，
// 对这类瞬时 5xx 重试若干次，退避间隔逐次加长。
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

class DownloadError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

async function downloadWithRetry(filename) {
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		try {
			await download(filename);
			return;
		} catch (error) {
			const status = error instanceof DownloadError ? error.status : undefined;
			if (status !== undefined && !RETRYABLE_STATUS.has(status)) throw error;
			if (attempt === MAX_ATTEMPTS) throw error;
			const delayMs = 1000 * 2 ** (attempt - 1);
			console.warn(`[ocr-models] ${filename} attempt ${attempt} failed, retrying in ${delayMs}ms`);
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
}

async function download(filename) {
	const dest = join(targetDir, filename);
	if (await fileExistsAndNonEmpty(dest)) {
		console.log(`[ocr-models] cached: ${filename}`);
		return;
	}
	const src = url(filename);
	console.log(`[ocr-models] fetching: ${src}`);
	const res = await fetch(src, { redirect: "follow" });
	if (!res.ok || !res.body) {
		throw new DownloadError(`Failed to download ${filename}: HTTP ${res.status}`, res.status);
	}
	await mkdir(dirname(dest), { recursive: true });
	const tmp = `${dest}.part`;
	const ws = createWriteStream(tmp);
	await pipeline(Readable.fromWeb(res.body), ws);
	await rename(tmp, dest);
	const s = await stat(dest);
	console.log(`[ocr-models] saved: ${filename} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
	await mkdir(targetDir, { recursive: true });
	for (const f of FILES) {
		await downloadWithRetry(f);
	}
	console.log(`[ocr-models] ready: ${targetDir}`);
}

main().catch((err) => {
	console.error("[ocr-models] failed:", err);
	process.exit(1);
});

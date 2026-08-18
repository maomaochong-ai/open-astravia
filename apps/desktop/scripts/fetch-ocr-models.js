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
		throw new Error(`Failed to download ${filename}: HTTP ${res.status}`);
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
		await download(f);
	}
	console.log(`[ocr-models] ready: ${targetDir}`);
}

main().catch((err) => {
	console.error("[ocr-models] failed:", err);
	process.exit(1);
});

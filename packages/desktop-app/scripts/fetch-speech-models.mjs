// Prepare the Windows-only Sherpa-ONNX model before build/package.
//
// Files are kept under resources/speech-models (gitignored), verified against
// the source-controlled manifest, and later copied into Electron
// extraResources. Runtime code never downloads model files.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const projectRoot = join(import.meta.dirname, "..");
export const SPEECH_MODEL_MANIFEST_PATH = join(
	projectRoot,
	"src",
	"main",
	"speech-input",
	"model-manifest.json",
);
export const SPEECH_MODEL_RESOURCE_ROOT = join(projectRoot, "resources", "speech-models");

function assertModelDefinition(value) {
	if (!value || typeof value !== "object") throw new Error("Speech model manifest must be an object");
	if (typeof value.id !== "string" || value.id.length === 0 || value.id.includes("/") || value.id.includes("\\")) {
		throw new Error("Speech model manifest has an invalid id");
	}
	if (!Number.isInteger(value.sampleRate) || value.sampleRate <= 0 || !Array.isArray(value.files)) {
		throw new Error("Speech model manifest has invalid sampleRate or files");
	}
	for (const file of value.files) {
		if (
			!file ||
			typeof file !== "object" ||
			typeof file.name !== "string" ||
			file.name.length === 0 ||
			file.name.includes("/") ||
			file.name.includes("\\") ||
			isAbsolute(file.name) ||
			!Number.isInteger(file.size) ||
			file.size <= 0 ||
			!/^https:\/\//.test(file.url) ||
			!/^[a-f0-9]{64}$/.test(file.sha256)
		) {
			throw new Error("Speech model manifest contains an invalid file");
		}
	}
	return value;
}

export async function readSpeechModelDefinition(manifestPath = SPEECH_MODEL_MANIFEST_PATH) {
	return assertModelDefinition(JSON.parse(await readFile(manifestPath, "utf8")));
}

export function resolveSpeechModelTargetTags(env = process.env, platform = process.platform, arch = process.arch) {
	const configured =
		env.VETTA_IM_GATEWAY_TARGET_PLATFORMS ?? env.VETTA_CLI_TARGET_PLATFORMS ?? env.VETTA_VENDOR_PLATFORM;
	return typeof configured === "string" && configured.trim().length > 0
		? configured
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean)
		: [`${platform}-${arch}`];
}

export function requiresWindowsSpeechModel(platformTags) {
	return platformTags.includes("win32-x64");
}

async function sha256(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

export async function verifySpeechModelFile(path, file) {
	try {
		const info = await stat(path);
		return info.isFile() && info.size === file.size && (await sha256(path)) === file.sha256;
	} catch {
		return false;
	}
}

async function downloadModelFile(file, destination, fetchImpl, log) {
	if (await verifySpeechModelFile(destination, file)) {
		log(`[speech-models] verified: ${file.name}`);
		return;
	}

	await mkdir(dirname(destination), { recursive: true });
	const partial = `${destination}.${process.pid}.part`;
	await rm(partial, { force: true });
	try {
		log(`[speech-models] fetching: ${file.url}`);
		const response = await fetchImpl(file.url, { redirect: "follow" });
		if (!response.ok || !response.body) {
			throw new Error(`HTTP ${response.status} while downloading ${file.name}`);
		}
		await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: "wx" }));
		if (!(await verifySpeechModelFile(partial, file))) {
			throw new Error(`Integrity check failed for ${file.name}`);
		}
		await rm(destination, { force: true });
		await rename(partial, destination);
		log(`[speech-models] saved: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MiB)`);
	} catch (error) {
		await rm(partial, { force: true });
		throw error;
	}
}

export async function prepareSpeechModel({
	model,
	targetRoot = SPEECH_MODEL_RESOURCE_ROOT,
	fetchImpl = fetch,
	log = console.log,
}) {
	const modelDirectory = join(targetRoot, model.id);
	for (const file of model.files) {
		await downloadModelFile(file, join(modelDirectory, file.name), fetchImpl, log);
	}
	return modelDirectory;
}

export async function prepareSpeechModels({
	platformTags = resolveSpeechModelTargetTags(),
	targetRoot = SPEECH_MODEL_RESOURCE_ROOT,
	manifestPath = SPEECH_MODEL_MANIFEST_PATH,
	fetchImpl = fetch,
	log = console.log,
} = {}) {
	if (!requiresWindowsSpeechModel(platformTags)) {
		log(`[speech-models] skipped for targets: ${platformTags.join(", ")}`);
		return null;
	}
	const model = await readSpeechModelDefinition(manifestPath);
	const modelDirectory = await prepareSpeechModel({ model, targetRoot, fetchImpl, log });
	log(`[speech-models] ready: ${modelDirectory}`);
	return { model, modelDirectory };
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
	prepareSpeechModels().catch((error) => {
		console.error("[speech-models] failed:", error);
		process.exitCode = 1;
	});
}

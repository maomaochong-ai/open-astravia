import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpeechInputStatus } from "../../preload/api-types/speech-input.js";
import { ApplicationCacheService } from "../cache/application-cache-service.js";
import type { DownloadModelFile } from "./download-file.js";
import { type SpeechModelDefinition, WINDOWS_ZIPFORMER_MODEL } from "./model-catalog.js";
import { SpeechModelManager } from "./model-manager.js";

const temporaryRoots: string[] = [];
const TEST_MODEL: SpeechModelDefinition = {
	id: "test-speech-model",
	sampleRate: 16_000,
	totalBytes: 3,
	files: [
		{
			name: "tokens.txt",
			size: 3,
			sha256: "0".repeat(64),
			url: "https://example.invalid/tokens.txt",
		},
	],
};

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createCache() {
	const root = await mkdtemp(join(tmpdir(), "vetta-speech-test-"));
	temporaryRoots.push(root);
	return new ApplicationCacheService(root).namespace("speech-recognition");
}

describe("SpeechModelManager", () => {
	it("only reports support on Windows x64", async () => {
		const cache = await createCache();
		const manager = new SpeechModelManager({ platform: "darwin", arch: "arm64", cache });

		await expect(manager.getStatus()).resolves.toMatchObject({
			supported: false,
			phase: "unsupported",
			errorCode: "unsupported-platform",
		});
	});

	it("installs all files before publishing the model as ready", async () => {
		const cache = await createCache();
		const statuses: SpeechInputStatus[] = [];
		const downloadFile: DownloadModelFile = async (file, destination, _signal, onProgress) => {
			await writeFile(destination, new Uint8Array(file.size));
			onProgress(file.size);
		};
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			cache,
			model: TEST_MODEL,
			downloadFile,
			onStatus: (status) => statuses.push(status),
		});

		await expect(manager.getStatus()).resolves.toMatchObject({ phase: "missing-model" });
		await expect(manager.download()).resolves.toMatchObject({ phase: "ready", downloadedBytes: 3 });
		await expect(manager.getStatus()).resolves.toMatchObject({ phase: "ready" });
		expect(statuses.some((status) => status.phase === "downloading")).toBe(true);
	});

	it("returns to missing-model when an in-flight download is cancelled", async () => {
		const cache = await createCache();
		let notifyStarted = (): void => undefined;
		const started = new Promise<void>((resolve) => {
			notifyStarted = resolve;
		});
		const downloadFile: DownloadModelFile = async (_file, _destination, signal) => {
			notifyStarted();
			await new Promise<void>((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		};
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			cache,
			model: TEST_MODEL,
			downloadFile,
		});

		const result = manager.download();
		await started;
		manager.cancelDownload();
		await expect(result).resolves.toMatchObject({ phase: "missing-model", downloadedBytes: 0 });
	});

	it("keeps the catalog total in sync with its files", () => {
		expect(WINDOWS_ZIPFORMER_MODEL.totalBytes).toBe(
			WINDOWS_ZIPFORMER_MODEL.files.reduce((total, file) => total + file.size, 0),
		);
	});
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SpeechModelDefinition } from "./model-catalog.js";
import { WINDOWS_ZIPFORMER_MODEL } from "./model-catalog.js";
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

async function createModelRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-speech-test-"));
	temporaryRoots.push(root);
	return root;
}

describe("SpeechModelManager", () => {
	it("only reports support on Windows x64", async () => {
		const modelRoot = await createModelRoot();
		const manager = new SpeechModelManager({ platform: "darwin", arch: "arm64", modelRoot });

		await expect(manager.getStatus()).resolves.toMatchObject({
			supported: false,
			phase: "unsupported",
			errorCode: "unsupported-platform",
		});
	});

	it("uses a complete model bundled by the build", async () => {
		const modelRoot = await createModelRoot();
		const modelDirectory = join(modelRoot, TEST_MODEL.id);
		await mkdir(modelDirectory);
		await writeFile(join(modelDirectory, "tokens.txt"), new Uint8Array(3));
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			modelRoot,
			model: TEST_MODEL,
		});

		await expect(manager.getStatus()).resolves.toMatchObject({ phase: "ready" });
		expect(manager.modelDirectory).toBe(modelDirectory);
	});

	it("reports a missing bundled model without attempting a download", async () => {
		const modelRoot = await createModelRoot();
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			modelRoot,
			model: TEST_MODEL,
		});

		await expect(manager.getStatus()).resolves.toMatchObject({
			phase: "unavailable",
			errorCode: "bundled-model-missing",
		});
	});

	it("rejects a bundled model file with the wrong size", async () => {
		const modelRoot = await createModelRoot();
		const modelDirectory = join(modelRoot, TEST_MODEL.id);
		await mkdir(modelDirectory);
		await writeFile(join(modelDirectory, "tokens.txt"), new Uint8Array(2));
		const manager = new SpeechModelManager({
			platform: "win32",
			arch: "x64",
			modelRoot,
			model: TEST_MODEL,
		});

		await expect(manager.getStatus()).resolves.toMatchObject({
			phase: "unavailable",
			errorCode: "bundled-model-invalid",
		});
	});

	it("keeps the catalog total in sync with its files", () => {
		expect(WINDOWS_ZIPFORMER_MODEL.totalBytes).toBe(
			WINDOWS_ZIPFORMER_MODEL.files.reduce((total, file) => total + file.size, 0),
		);
	});
});

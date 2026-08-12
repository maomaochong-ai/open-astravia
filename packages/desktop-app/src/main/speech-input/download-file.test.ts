import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadModelFile, ModelIntegrityError } from "./download-file.js";
import type { SpeechModelFile } from "./model-catalog.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function destinationPath(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-speech-download-test-"));
	temporaryRoots.push(root);
	return join(root, "tokens.txt");
}

function modelFile(bytes: Uint8Array, overrides: Partial<SpeechModelFile> = {}): SpeechModelFile {
	return {
		name: "tokens.txt",
		size: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		url: "https://example.invalid/tokens.txt",
		...overrides,
	};
}

describe("downloadModelFile", () => {
	it("streams a file and verifies its length and digest", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(bytes)),
		);
		const destination = await destinationPath();
		const progress: number[] = [];

		await downloadModelFile(modelFile(bytes), destination, new AbortController().signal, (value) =>
			progress.push(value),
		);

		expect(new Uint8Array(await readFile(destination))).toEqual(bytes);
		expect(progress.at(-1)).toBe(bytes.byteLength);
	});

	it("rejects and removes content that exceeds the pinned size", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(bytes)),
		);
		const destination = await destinationPath();

		await expect(
			downloadModelFile(modelFile(bytes, { size: 2 }), destination, new AbortController().signal, () => undefined),
		).rejects.toBeInstanceOf(ModelIntegrityError);
		await expect(stat(destination)).rejects.toThrow();
	});
});

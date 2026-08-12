import { createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { SpeechModelFile } from "./model-catalog.js";

export class ModelIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelIntegrityError";
	}
}

export type DownloadModelFile = (
	file: SpeechModelFile,
	destination: string,
	signal: AbortSignal,
	onProgress: (receivedBytes: number) => void,
) => Promise<void>;

export const downloadModelFile: DownloadModelFile = async (file, destination, signal, onProgress) => {
	await mkdir(dirname(destination), { recursive: true });
	const response = await fetch(file.url, { signal, redirect: "follow" });
	if (!response.ok || !response.body) {
		throw new Error(`Model download failed with HTTP ${response.status}`);
	}

	const output = await open(destination, "w");
	const reader = response.body.getReader();
	const digest = createHash("sha256");
	let receivedBytes = 0;

	try {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				signal.throwIfAborted();
				if (receivedBytes + value.byteLength > file.size) {
					throw new ModelIntegrityError(`Model file exceeds expected size: ${file.name}`);
				}
				let writeOffset = 0;
				while (writeOffset < value.byteLength) {
					const { bytesWritten } = await output.write(value, writeOffset, value.byteLength - writeOffset);
					if (bytesWritten === 0) throw new Error(`Unable to write model file: ${file.name}`);
					writeOffset += bytesWritten;
				}
				digest.update(value);
				receivedBytes += value.byteLength;
				onProgress(receivedBytes);
			}
		} catch (error) {
			await reader.cancel().catch(() => undefined);
			throw error;
		} finally {
			await output.close();
		}
	} catch (error) {
		await rm(destination, { force: true });
		throw error;
	}

	if (receivedBytes !== file.size || digest.digest("hex") !== file.sha256) {
		await rm(destination, { force: true });
		throw new ModelIntegrityError(`Model file integrity check failed: ${file.name}`);
	}
};

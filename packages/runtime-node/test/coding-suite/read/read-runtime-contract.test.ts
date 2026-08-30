import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node";
import { RuntimeConfigurationCenter, RuntimeConfigurationSnapshotCoordinator } from "@vetta/runtime-core/configuration";
import type { RuntimeSnapshotAcquireContext } from "@vetta/runtime-core/kernel";
import { CODING_IMAGE_CONFIGURATION } from "@vetta/runtime-tools";
import { describe, expect, it } from "vitest";
import { createReadTool, createReadToolRegistration, type ImageResizeOptions } from "../../../src/coding/index.js";
import type { ReadBehaviorSubject, ReadBehaviorSubjectOptions } from "./read-behavior-contract.js";
import { defineReadBehaviorContract } from "./read-behavior-contract.js";

interface ReadImageDetails {
	readonly image?: {
		readonly processedMimeType?: string;
	};
}

const REAL_IMAGE_PROCESSING_TIMEOUT_MS = 20_000;

function createRuntimeSubject(cwd: string, options?: ReadBehaviorSubjectOptions): ReadBehaviorSubject {
	const registration = createReadToolRegistration(cwd, options);
	return {
		definition: {
			name: registration.tool.name,
			label: registration.tool.label,
			description: registration.tool.description,
			schema: registration.tool.inputSchema,
		},
		execute(input, signal = new AbortController().signal) {
			return registration.tool.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-read-contract",
				input,
				signal,
			});
		},
	};
}

defineReadBehaviorContract("runtime", createRuntimeSubject);

describe("read runtime boundaries", () => {
	it("binds native image settings from the shared Runtime Configuration protocol", async () => {
		const center = new RuntimeConfigurationCenter();
		center.definitions.upsert({
			source: { id: "runtime-tools", revision: "1" },
			definition: CODING_IMAGE_CONFIGURATION,
		});
		center.layers.replaceSource({ id: "test-settings", revision: "1" }, [
			{
				id: "test.images",
				revision: "1",
				precedence: 100,
				values: { [CODING_IMAGE_CONFIGURATION.id]: { resize: { maxWidth: 640 } } },
			},
		]);
		const captured: ImageResizeOptions[] = [];
		const registration = createReadToolRegistration(process.cwd(), {
			configurationSource: new RuntimeConfigurationSnapshotCoordinator(center),
			operations: {
				async access() {},
				async detectImageMimeType() {
					return "image/png";
				},
				async readFile() {
					return Buffer.from("image");
				},
			},
			imageProcessor: {
				async resize(buffer, mimeType, options) {
					if (!options) throw new Error("Expected configured resize options");
					captured.push(options);
					return {
						data: buffer.toString("base64"),
						mimeType,
						originalWidth: 10,
						originalHeight: 10,
						width: 10,
						height: 10,
						wasResized: false,
					};
				},
			},
		});
		const binding = registration.tool.bindForTurn?.(turnContext("configured-read"));
		if (!binding) throw new Error("Expected configured Read binding");

		expect(registration.configuration).toEqual({
			configurationIds: [CODING_IMAGE_CONFIGURATION.id],
			requiredConfigurationIds: [CODING_IMAGE_CONFIGURATION.id],
			support: "native",
		});
		await binding.tool.execute({
			sessionId: "session-1",
			turnId: "configured-read",
			toolCallId: "configured-read-call",
			input: { path: "image.png" },
			signal: new AbortController().signal,
		});
		expect(captured).toHaveLength(1);
		expect(captured[0]?.maxWidth).toBe(640);
		expect(captured[0]?.maxHeight).toBe(CODING_IMAGE_CONFIGURATION.defaultValue.resize.maxHeight);
		await binding.release();
		await center.close();
	});

	it("keeps the image processor behind an injectable read boundary", async () => {
		let resizeCount = 0;
		const tool = createReadTool(process.cwd(), {
			operations: {
				async access() {},
				async detectImageMimeType() {
					return "image/png";
				},
				async readFile() {
					return Buffer.from("image");
				},
			},
			imageProcessor: {
				async resize() {
					resizeCount += 1;
					return {
						data: Buffer.from("processed").toString("base64"),
						mimeType: "image/png",
						originalWidth: 10,
						originalHeight: 10,
						width: 10,
						height: 10,
						wasResized: false,
					};
				},
			},
		});

		const result = await tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-image",
			input: { path: "remote-image" },
			signal: new AbortController().signal,
		});

		expect(resizeCount).toBe(1);
		expect(result.content.some((item) => item.type === "image")).toBe(true);
	});

	it(
		"resizes a real 3840x2160 JPEG through the production read path",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "vetta-read-large-image-"));
			const imagePath = join(directory, "large.jpg");
			const source = PhotonImage.new_from_byteslice(
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
					"base64",
				),
			);
			const large = resize(source, 3840, 2160, SamplingFilter.Nearest);
			try {
				await writeFile(imagePath, large.get_bytes_jpeg(90));
			} finally {
				large.free();
				source.free();
			}

			try {
				const result = await createReadTool(directory).execute({
					sessionId: "session-1",
					turnId: "turn-1",
					toolCallId: "runtime-large-image",
					input: { path: imagePath },
					signal: new AbortController().signal,
				});

				expect(result.content.map((item) => item.type)).toEqual(["text", "image"]);
				const image = result.content[1];
				if (image?.type !== "image") throw new Error("Expected resized image content");
				const decoded = PhotonImage.new_from_byteslice(Buffer.from(image.data, "base64"));
				try {
					expect(decoded.get_width()).toBe(1280);
					expect(decoded.get_height()).toBe(720);
				} finally {
					decoded.free();
				}
				expect(result.details).toMatchObject({
					image: {
						originalMimeType: "image/jpeg",
						originalWidth: 3840,
						originalHeight: 2160,
						processedWidth: 1280,
						processedHeight: 720,
						wasResized: true,
					},
				});
				expect((result.details as ReadImageDetails | undefined)?.image?.processedMimeType).toBe(image.mimeType);
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		},
		REAL_IMAGE_PROCESSING_TIMEOUT_MS,
	);
});

function turnContext(operationId: string): RuntimeSnapshotAcquireContext {
	return {
		sessionId: "session-1",
		operationId,
		reason: "turn",
		signal: new AbortController().signal,
	};
}

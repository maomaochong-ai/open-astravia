import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhotonImage, resize, SamplingFilter } from "@silvia-odwyer/photon-node";
import { describe, expect, it } from "vitest";
import { createReadTool, createReadToolRegistration } from "../../../src/coding/index.js";
import type { ReadBehaviorSubject, ReadBehaviorSubjectOptions } from "./read-behavior-contract.js";
import { defineReadBehaviorContract } from "./read-behavior-contract.js";

interface ReadImageDetails {
	readonly image?: {
		readonly processedMimeType?: string;
	};
}

function createRuntimeSubject(cwd: string, options?: ReadBehaviorSubjectOptions): ReadBehaviorSubject {
	const registration = createReadToolRegistration(cwd, options);
	return {
		definition: {
			name: registration.tool.name,
			label: registration.tool.label,
			description: registration.tool.description,
			schema: registration.tool.inputSchema,
			scopeUse: registration.scopeUse,
			category: registration.category,
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

	it("resizes a real 3840x2160 JPEG through the production read path", async () => {
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
	});
});

import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_MEDIA_CAPABILITIES,
	DOMAIN_MEDIA_CAPABILITY_CATALOG,
	MEDIA_GENERATION_MODES,
	MEDIA_KINDS,
	MEDIA_OPERATIONS,
} from "../../src/domain.js";
import { JOB_STATUSES } from "../../src/foundation.js";

describe("media domain capabilities", () => {
	it("uses one stable id per media operation", () => {
		expect(Object.values(DOMAIN_MEDIA_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.provider.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.job.submit`,
		]);
	});

	it("validates generation requests and strips unknown fields", () => {
		expect(DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.parseInput({})).toEqual({});
		expect(() => DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.parseInput({ ignored: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT.parseInput({
				ownerId: "image-gen",
				providerId: "desktop-app:vetta",
				operation: MEDIA_OPERATIONS.GENERATE,
				kind: MEDIA_KINDS.IMAGE,
				mode: MEDIA_GENERATION_MODES.TEXT_TO_IMAGE,
				prompt: "draw a fox",
				dimensions: { width: 1024, height: 1024 },
				inputs: [],
				ignored: true,
			}),
		).toEqual({
			ownerId: "image-gen",
			providerId: "desktop-app:vetta",
			operation: "generate",
			kind: "image",
			mode: "text-to-image",
			prompt: "draw a fox",
			dimensions: { width: 1024, height: 1024 },
			inputs: [],
		});
	});

	it("preserves semantic input roles and mode capability metadata", () => {
		expect(
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT.parseInput({
				ownerId: "content-creation",
				providerId: "plugin:minimax-h3",
				operation: "generate",
				kind: "video",
				mode: "image-to-video",
				prompt: "transition",
				inputs: [
					{
						role: "lastFrame",
						kind: "image",
						source: { type: "storage-blob", namespace: "content-creation", id: "last" },
					},
				],
			}),
		).toMatchObject({ inputs: [{ role: "lastFrame", kind: "image" }] });
		expect(
			DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.parseOutput([
				{
					id: "plugin:minimax-h3",
					ownerId: "comfyui-media-provider",
					protocolVersion: 4,
					capabilities: [
						{
							operation: "generate",
							kind: "video",
							modes: ["image-to-video"],
							modeCapabilities: [
								{
									mode: "image-to-video",
									inputs: [{ role: "firstFrame", kinds: ["image"], minItems: 0, maxItems: 1 }],
									minTotalItems: 1,
									aspectRatioPolicy: "input-derived",
								},
							],
						},
					],
				},
			]),
		).toMatchObject([
			{
				capabilities: [
					{ modeCapabilities: [{ inputs: [{ role: "firstFrame" }], aspectRatioPolicy: "input-derived" }] },
				],
			},
		]);
	});

	it("validates composition without binding the document format to an engine", () => {
		expect(
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT.parseInput({
				ownerId: "video-editor",
				providerId: "renderer:timeline",
				operation: "compose",
				inputs: [
					{
						kind: "document",
						mimeType: "application/vnd.example.timeline+json",
						source: { type: "storage-blob", namespace: "video-editor", id: "project" },
					},
				],
				output: { kind: "video", mimeType: "video/mp4", fps: 30 },
			}),
		).toMatchObject({ operation: "compose", output: { kind: "video", mimeType: "video/mp4", fps: 30 } });
		expect(() =>
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT.parseInput({
				ownerId: "video-editor",
				providerId: "renderer:timeline",
				operation: "compose",
				inputs: [
					{
						kind: "document",
						source: { type: "plugin-blob", namespace: "video-editor", blobId: "project" },
					},
				],
				output: { kind: "video", mimeType: "video/mp4" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("validates host jobs with temporary artifacts", () => {
		expect(
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT.parseOutput({
				id: "job-1",
				domain: "media",
				operation: "generate",
				status: JOB_STATUSES.SUCCEEDED,
				artifacts: [
					{
						id: "artifact-1",
						kind: "image",
						mimeType: "image/png",
						sizeBytes: 5,
						lifetime: "temporary",
					},
				],
			}),
		).toMatchObject({
			id: "job-1",
			domain: "media",
			status: "succeeded",
			artifacts: [{ kind: "image", lifetime: "temporary" }],
		});
	});

	it("preserves video artifact kind through job output cleaning", () => {
		expect(
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT.parseOutput({
				id: "job-video",
				domain: "media",
				operation: "generate",
				status: JOB_STATUSES.SUCCEEDED,
				progress: { value: 1 },
				artifacts: [
					{
						id: "artifact-video",
						kind: "video",
						mimeType: "video/mp4",
						sizeBytes: 1280,
						lifetime: "temporary",
						width: 1280,
						height: 720,
						durationSeconds: 5,
					},
				],
			}),
		).toEqual({
			id: "job-video",
			domain: "media",
			operation: "generate",
			status: "succeeded",
			progress: { value: 1 },
			artifacts: [
				{
					id: "artifact-video",
					kind: "video",
					mimeType: "video/mp4",
					sizeBytes: 1280,
					lifetime: "temporary",
					width: 1280,
					height: 720,
					durationSeconds: 5,
				},
			],
		});
	});

	it("publishes media schemas in its catalog", () => {
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG).toHaveLength(2);
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({ type: "array" });
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG[1]?.inputSchema).toHaveProperty("anyOf");
	});
});

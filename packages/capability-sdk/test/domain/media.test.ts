import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_MEDIA_CAPABILITIES,
	DOMAIN_MEDIA_CAPABILITY_CATALOG,
	MEDIA_GENERATION_MODES,
	MEDIA_JOB_STATUSES,
	MEDIA_KINDS,
} from "../../src/domain.js";

describe("media domain capabilities", () => {
	it("uses one stable id per media operation", () => {
		expect(Object.values(DOMAIN_MEDIA_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.provider.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.job.create`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.job.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.job.cancel`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.artifact.save`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}media.artifact.release`,
		]);
	});

	it("validates media requests and strips unknown fields", () => {
		expect(DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.parseInput({})).toEqual({});
		expect(() => DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.parseInput({ ignored: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseInput({
				providerId: "desktop-app:vetta",
				kind: MEDIA_KINDS.IMAGE,
				mode: MEDIA_GENERATION_MODES.TEXT_TO_IMAGE,
				prompt: "draw a fox",
				dimensions: { width: 1024, height: 1024 },
				ignored: true,
			}),
		).toEqual({
			providerId: "desktop-app:vetta",
			kind: MEDIA_KINDS.IMAGE,
			mode: MEDIA_GENERATION_MODES.TEXT_TO_IMAGE,
			prompt: "draw a fox",
			dimensions: { width: 1024, height: 1024 },
		});
		expect(() =>
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseInput({
				providerId: "desktop-app:vetta",
				kind: MEDIA_KINDS.IMAGE,
				mode: MEDIA_GENERATION_MODES.TEXT_TO_IMAGE,
				prompt: "",
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("validates terminal media jobs", () => {
		expect(
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseOutput({
				id: "job-auth",
				providerId: "desktop-app:vetta",
				status: MEDIA_JOB_STATUSES.FAILED,
				error: { code: "unauthenticated", message: "Not signed in", retryable: false },
			}),
		).toMatchObject({ status: "failed", error: { code: "unauthenticated" } });
		expect(
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseOutput({
				id: "job-1",
				providerId: "desktop-app:vetta",
				status: MEDIA_JOB_STATUSES.SUCCEEDED,
				artifacts: [{ id: "artifact-1", kind: MEDIA_KINDS.IMAGE, mimeType: "image/png", sizeBytes: 5 }],
			}),
		).toMatchObject({ id: "job-1", providerId: "desktop-app:vetta", status: "succeeded" });
		expect(() =>
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseOutput({
				id: "job-1",
				providerId: "desktop-app:vetta",
				status: "unknown",
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("accepts handle references and rejects legacy inline media data", () => {
		expect(
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseInput({
				providerId: "desktop-app:vetta",
				kind: MEDIA_KINDS.VIDEO,
				mode: MEDIA_GENERATION_MODES.IMAGE_TO_VIDEO,
				prompt: "animate",
				references: [
					{
						id: "reference-1",
						kind: MEDIA_KINDS.IMAGE,
						mimeType: "image/png",
						source: { type: "plugin-blob", namespace: "content-creation", blobId: "blob-1" },
					},
				],
			}),
		).toMatchObject({
			references: [
				{
					source: { type: "plugin-blob", namespace: "content-creation", blobId: "blob-1" },
				},
			],
		});
		expect(() =>
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseInput({
				providerId: "desktop-app:vetta",
				kind: MEDIA_KINDS.IMAGE,
				mode: MEDIA_GENERATION_MODES.IMAGE_TO_IMAGE,
				prompt: "edit",
				references: [{ id: "legacy", kind: MEDIA_KINDS.IMAGE, mimeType: "image/png", data: "aW1hZ2U=" }],
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("validates explicit artifact persistence and release requests", () => {
		expect(
			DOMAIN_MEDIA_CAPABILITIES.SAVE_ARTIFACT.parseInput({
				artifactId: "artifact-1",
				destination: { type: "workspace-file", path: "C:/workspace/output/image.png" },
			}),
		).toEqual({
			artifactId: "artifact-1",
			destination: { type: "workspace-file", path: "C:/workspace/output/image.png" },
		});
		expect(DOMAIN_MEDIA_CAPABILITIES.RELEASE_ARTIFACT.parseInput({ artifactId: "artifact-1" })).toEqual({
			artifactId: "artifact-1",
		});
	});

	it("publishes media schemas in its catalog", () => {
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG).toHaveLength(6);
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({ type: "array" });
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG[1]?.inputSchema).toMatchObject({
			type: "object",
			required: ["providerId", "kind", "mode", "prompt"],
		});
	});
});

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
				artifacts: [{ kind: MEDIA_KINDS.IMAGE, mimeType: "image/png", data: "aW1hZ2U=" }],
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

	it("publishes media schemas in its catalog", () => {
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG).toHaveLength(4);
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({ type: "array" });
		expect(DOMAIN_MEDIA_CAPABILITY_CATALOG[1]?.inputSchema).toMatchObject({
			type: "object",
			required: ["providerId", "kind", "mode", "prompt"],
		});
	});
});

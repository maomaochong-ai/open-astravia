import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES } from "../../src/contracts.js";
import { DOMAIN_OCR_CAPABILITIES, OCR_PROTOCOL_VERSION } from "../../src/domain.js";

describe("OCR domain capabilities", () => {
	it("accepts a batch of opaque image references and strips no core data", () => {
		const request = DOMAIN_OCR_CAPABILITIES.RECOGNIZE.parseInput({
			ownerId: "shimo-reader",
			providerId: "desktop-app:ppocrv5",
			inputs: [
				{
					id: "p1",
					mimeType: "image/png",
					source: { type: "storage-blob", namespace: "shimo-reader", id: "blob-1" },
				},
				{ id: "p2", mimeType: "image/png", source: { type: "workspace-file", path: "C:/book/page-2.png" } },
			],
			granularity: "line",
		});
		expect(request.inputs).toHaveLength(2);
		expect(request.granularity).toBe("line");
		expect(OCR_PROTOCOL_VERSION).toBe(1);
	});

	it("rejects empty batches and malformed provider results at the boundary", () => {
		expect(() => DOMAIN_OCR_CAPABILITIES.RECOGNIZE.parseInput({ ownerId: "x", inputs: [] })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() =>
			DOMAIN_OCR_CAPABILITIES.RECOGNIZE.parseOutput({ protocolVersion: 1, providerId: "p", items: [] }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});
});

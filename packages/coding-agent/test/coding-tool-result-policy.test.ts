import { Buffer } from "node:buffer";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import type { CodingToolResultArtifactStore } from "../src/tool-results/contracts.js";
import { createCodingAgentCodingToolResultPolicy } from "../src/tool-results/result-policy.js";

const context = {
	sessionId: "session-1",
	turnId: "turn-1",
	toolCallId: "call-1",
	toolName: "read",
	category: "core" as const,
};

describe("coding agent coding tool result policy", () => {
	it("preserves small and external results", async () => {
		const store = artifactStore();
		const policy = createCodingAgentCodingToolResultPolicy({ artifactStore: store, maxInlineResultBytes: 8 });
		const small = textResult("small");
		const external = textResult("large external result");

		expect(await policy.project(small, context)).toBe(small);
		expect(await policy.project(external, { ...context, category: "external" })).toBe(external);
		expect(store.write).not.toHaveBeenCalled();
	});

	it("offloads the full result while preserving details and images", async () => {
		const store = artifactStore();
		const policy = createCodingAgentCodingToolResultPolicy({ artifactStore: store, maxInlineResultBytes: 20 });
		const details = { exitCode: 0 };
		const result: RuntimeToolResult = {
			content: [
				{ type: "text", text: "start-0123456789-end-abcdefghij" },
				{ type: "image", data: "image-data", mimeType: "image/png" },
			],
			details,
		};

		const projected = await policy.project(result, context);

		expect(projected.details).toBe(details);
		expect(projected.content[0]?.type === "text" ? projected.content[0].text : "").toContain(
			"Full result: artifact.json",
		);
		expect(projected.content[1]).toEqual({ type: "image", data: "image-data", mimeType: "image/png" });
		const request = vi.mocked(store.write).mock.calls[0]?.[0];
		expect(request ? JSON.parse(request.data) : undefined).toEqual({ content: result.content, details });
		expect(request?.byteLength).toBe(Buffer.byteLength(request?.data ?? "", "utf8"));
	});

	it("measures image and details payloads instead of text alone", async () => {
		const store = artifactStore();
		const policy = createCodingAgentCodingToolResultPolicy({ artifactStore: store, maxInlineResultBytes: 20 });
		const result: RuntimeToolResult = {
			content: [
				{ type: "text", text: "ok" },
				{ type: "image", data: "x".repeat(40), mimeType: "image/png" },
			],
			details: { diagnostic: "y".repeat(40) },
		};

		const projected = await policy.project(result, context);

		expect(store.write).toHaveBeenCalledOnce();
		expect(projected.content[0]).toMatchObject({ type: "text" });
		expect(projected.content[0]?.type === "text" ? projected.content[0].text : "").toContain(
			"Full result: artifact.json",
		);
		expect(projected.content[1]).toBe(result.content[1]);
		expect(projected.details).toBe(result.details);
	});

	it("keeps the only result copy when artifact storage fails", async () => {
		const store: CodingToolResultArtifactStore = {
			write: vi.fn(async () => {
				throw new Error("disk unavailable");
			}),
		};
		const policy = createCodingAgentCodingToolResultPolicy({ artifactStore: store, maxInlineResultBytes: 4 });
		const result = textResult("large result");

		expect(await policy.project(result, context)).toBe(result);
	});
});

function artifactStore(): CodingToolResultArtifactStore & { readonly write: ReturnType<typeof vi.fn> } {
	return { write: vi.fn(async () => ({ reference: "artifact.json" })) };
}

function textResult(text: string): RuntimeToolResult {
	return { content: [{ type: "text", text }] };
}

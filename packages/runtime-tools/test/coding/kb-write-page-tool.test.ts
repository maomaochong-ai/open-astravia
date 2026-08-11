import { describe, expect, it, vi } from "vitest";
import {
	createKbWritePageTool,
	createKbWritePageToolRegistration,
	KB_WRITE_PAGE_TOOL_DESCRIPTION,
	type KbWritePageOperations,
} from "../../src/coding/index.js";

describe("kb_write_page", () => {
	it("preserves the model contract and registration metadata", () => {
		const registration = createKbWritePageToolRegistration({ operations: createOperations() });

		expect(registration.tool.name).toBe("kb_write_page");
		expect(registration.tool.label).toBe("KB Write Page");
		expect(registration.tool.description).toBe(KB_WRITE_PAGE_TOOL_DESCRIPTION);
		expect(registration.scopeUse).toEqual(["kb-processing"]);
		expect(registration.requires).toEqual(["knowledge"]);
		expect(registration.category).toBe("kb-write");
	});

	it("forwards the write request and preserves the legacy result text", async () => {
		const write = vi.fn(async () => ({
			action: "update" as const,
			id: "page-1",
			path: "产品/计费.md",
			movedFrom: "旧目录/计费.md",
		}));
		const tool = createKbWritePageTool({
			operations: {
				write,
				resolveAbsolutePath: (path) => `/knowledge/wiki/${path}`,
			},
			now: () => new Date("2026-08-04T10:00:00.000Z"),
		});
		const input = {
			description: "Update page",
			path: "产品/计费.md",
			source: "manual",
			source_path: "计费.md",
			source_hash: "hash-1",
			tags: ["产品"],
			title: "计费",
			summary: "计费规则",
			body: "正文",
			id: "page-1",
		};

		const result = await tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input,
			signal: new AbortController().signal,
		});

		expect(write).toHaveBeenCalledWith(input, "2026-08-04T10:00:00.000Z");
		expect(result).toEqual({
			content: [
				{
					type: "text",
					text: "kb_write_page update ok — id=page-1, path=/knowledge/wiki/产品/计费.md (moved from 旧目录/计费.md)",
				},
			],
			details: {
				action: "update",
				id: "page-1",
				path: "产品/计费.md",
				absolutePath: "/knowledge/wiki/产品/计费.md",
				movedFrom: "旧目录/计费.md",
			},
		});
	});
});

function createOperations(): KbWritePageOperations {
	return {
		write: async () => ({ action: "create", id: "page-1", path: "page.md" }),
		resolveAbsolutePath: (path) => path,
	};
}

import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createImSendAttachmentTool,
	createImSendAttachmentToolRegistration,
	IM_SEND_ATTACHMENT_TOOL_DESCRIPTION,
	type ImSendAttachmentFileOperations,
} from "../../src/coding/index.js";

describe("im_send_attachment", () => {
	it("preserves the model contract and registration metadata", () => {
		const registration = createImSendAttachmentToolRegistration({
			sender: { sendAttachment: vi.fn(async () => ({})) },
		});

		expect(registration.tool.name).toBe("im_send_attachment");
		expect(registration.tool.label).toBe("Send IM Attachment");
		expect(registration.tool.description).toBe(IM_SEND_ATTACHMENT_TOOL_DESCRIPTION);
		expect(registration.scopeUse).toEqual(["im-claw"]);
		expect(registration.category).toBe("im");
		expect(registration.requires).toBeUndefined();
		// 外发不可撤回且工具自身无确认对话框，注册处必须声明 heavy，由宿主首调确认闸兜底。
		expect(registration.sideEffect).toBe("heavy");
	});

	it("accepts a platform-native absolute file and forwards it to the sender", async () => {
		const path = join(tmpdir(), `vetta-im-attachment-${crypto.randomUUID()}.txt`);
		await writeFile(path, "attachment", "utf8");
		const sendAttachment = vi.fn(async () => ({ messageId: "message-1" }));
		const tool = createImSendAttachmentTool({ sender: { sendAttachment } });

		try {
			const result = await execute(tool, { description: "Send test attachment", path, kind: "file" });

			expect(sendAttachment).toHaveBeenCalledWith({ path, kind: "file", caption: undefined });
			expect(result).toEqual({
				content: [{ type: "text", text: `Sent file attachment ${path} (messageId=message-1)` }],
				details: { path, kind: "file", messageId: "message-1" },
			});
		} finally {
			await rm(path, { force: true });
		}
	});

	it.each([
		{
			name: "relative path",
			path: "relative.txt",
			operations: operations({ absolute: false, exists: true, file: true }),
			error: 'im_send_attachment: path must be absolute, got "relative.txt"',
		},
		{
			name: "missing file",
			path: "/missing.txt",
			operations: operations({ absolute: true, exists: false, file: true }),
			error: "im_send_attachment: file not found: /missing.txt",
		},
		{
			name: "non-file path",
			path: "/directory",
			operations: operations({ absolute: true, exists: true, file: false }),
			error: "im_send_attachment: not a regular file: /directory",
		},
	])("rejects $name with the legacy error text", async ({ path, operations: fileOperations, error }) => {
		const tool = createImSendAttachmentTool({
			sender: { sendAttachment: vi.fn(async () => ({})) },
			fileOperations,
		});

		await expect(execute(tool, { description: "Send attachment", path, kind: "file" })).rejects.toThrow(error);
	});

	it("forwards host failures without rewriting them", async () => {
		const tool = createImSendAttachmentTool({
			sender: {
				sendAttachment: vi.fn(async () => {
					throw new Error("quota_exhausted");
				}),
			},
			fileOperations: operations({ absolute: true, exists: true, file: true }),
		});

		await expect(
			execute(tool, { description: "Send attachment", path: "/attachment.pdf", kind: "file" }),
		).rejects.toThrow("quota_exhausted");
	});
});

function operations(options: {
	readonly absolute: boolean;
	readonly exists: boolean;
	readonly file: boolean;
}): ImSendAttachmentFileOperations {
	return {
		isAbsolute: () => options.absolute,
		exists: () => options.exists,
		isFile: () => options.file,
	};
}

function execute(
	tool: ReturnType<typeof createImSendAttachmentTool>,
	input: { readonly description: string; readonly path: string; readonly kind: "image" | "file" },
) {
	return tool.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "call-1",
		input,
		signal: new AbortController().signal,
	});
}

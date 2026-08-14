import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { IM_SEND_ATTACHMENT_TOOL_DESCRIPTION } from "./description.js";

export const ImSendAttachmentToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	path: Type.String({ description: "Absolute path to the local file to send." }),
	kind: Type.Union([Type.Literal("image"), Type.Literal("file")], {
		description: "image = render inline (jpg/png/gif/webp); file = everything else.",
	}),
	caption: Type.Optional(Type.String({ description: "Optional short text accompanying the attachment." })),
});

export type ImSendAttachmentToolInput = Static<typeof ImSendAttachmentToolInputSchema>;

export interface ImSendAttachmentToolDetails {
	readonly messageId?: string;
	readonly kind: "image" | "file";
	readonly path: string;
}

export interface ImSendAttachmentSender {
	sendAttachment(params: {
		readonly path: string;
		readonly kind: "image" | "file";
		readonly caption?: string;
	}): Promise<{ readonly messageId?: string }>;
}

export interface ImSendAttachmentFileOperations {
	isAbsolute(path: string): boolean;
	exists(path: string): boolean;
	isFile(path: string): boolean;
}

export interface ImSendAttachmentToolOptions {
	readonly sender: ImSendAttachmentSender;
	readonly fileOperations?: ImSendAttachmentFileOperations;
}

const defaultFileOperations: ImSendAttachmentFileOperations = {
	isAbsolute,
	exists: existsSync,
	isFile: (path) => statSync(path).isFile(),
};

export function createImSendAttachmentTool(
	options: ImSendAttachmentToolOptions,
): RuntimeToolDefinition<ImSendAttachmentToolInput> {
	const fileOperations = options.fileOperations ?? defaultFileOperations;
	return {
		name: "im_send_attachment",
		label: "Send IM Attachment",
		description: IM_SEND_ATTACHMENT_TOOL_DESCRIPTION,
		inputSchema: ImSendAttachmentToolInputSchema,
		async execute({ input }) {
			if (!input.path || !fileOperations.isAbsolute(input.path)) {
				throw new Error(`im_send_attachment: path must be absolute, got ${JSON.stringify(input.path)}`);
			}
			if (!fileOperations.exists(input.path)) {
				throw new Error(`im_send_attachment: file not found: ${input.path}`);
			}
			if (!fileOperations.isFile(input.path)) {
				throw new Error(`im_send_attachment: not a regular file: ${input.path}`);
			}

			const result = await options.sender.sendAttachment({
				path: input.path,
				kind: input.kind,
				caption: input.caption,
			});
			const details: ImSendAttachmentToolDetails = {
				messageId: result.messageId,
				kind: input.kind,
				path: input.path,
			};
			const summary =
				`Sent ${input.kind} attachment ${input.path}` +
				(result.messageId ? ` (messageId=${result.messageId})` : "");
			return {
				content: [{ type: "text", text: summary }],
				details,
			};
		},
	};
}

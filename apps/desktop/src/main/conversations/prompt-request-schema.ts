import { isAbsolute } from "node:path";
import type { PromptRequest } from "@vetta/runtime-core";
import { isSshProjectUri, parseProjectLocation } from "@vetta/ssh-transport";
import { z } from "zod";

export const promptResourceRefSchema = z
	.object({
		kind: z.enum(["skill", "scene"]),
		name: z.string().trim().min(1),
	})
	.passthrough();

export const promptAttachmentRefSchema = z
	.object({
		kind: z.enum(["file", "directory", "image"]),
		path: z
			.string()
			.trim()
			.min(1)
			.refine((path) => isAbsolute(path) || isSshProjectUri(path), "Attachment path must be absolute")
			.transform(toToolFacingAttachmentPath),
	})
	.passthrough();

/**
 * 文件面板与 @ 选择器给出的远端文件是 `ssh://<hostId>/<路径>`——那是宿主用来决定「去哪台
 * 机器读」的标识。附件路径最终写进给模型的提示里，模型再拿它去喂跑在远端的 read，所以
 * 这里换成远端上的绝对路径；原样放行 URI 的话模型读的是一个叫 `ssh:` 的目录。
 */
function toToolFacingAttachmentPath(path: string): string {
	if (!isSshProjectUri(path)) return path;
	const location = parseProjectLocation(path);
	return location.kind === "ssh" ? location.remotePath : path;
}

const promptImageSchema = z
	.object({
		type: z.literal("image"),
		data: z.string(),
		mimeType: z.string(),
	})
	.passthrough();

export const promptRequestSchema: z.ZodType<PromptRequest> = z
	.object({
		text: z.string().min(1),
		promptRef: promptResourceRefSchema.optional(),
		attachments: z.array(promptAttachmentRefSchema).optional(),
		images: z.array(promptImageSchema).optional(),
		streamingBehavior: z.enum(["steer", "followUp"]).optional(),
		modelKey: z.string().min(1).optional(),
		reasoning: z.string().min(1).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

export function parsePromptRequest(value: unknown): PromptRequest {
	const result = promptRequestSchema.safeParse(value);
	if (result.success) return result.data;
	const issue = result.error.issues[0];
	const path = issue?.path.map(String).join(".");
	throw new Error(`Invalid prompt request${path ? ` ${path}` : ""}${issue ? `: ${issue.message}` : ""}`);
}

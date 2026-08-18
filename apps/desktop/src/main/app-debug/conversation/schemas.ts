import { z } from "zod";
import { promptAttachmentRefSchema, promptResourceRefSchema } from "../../conversations/prompt-request-schema.js";

const executionModeSchema = z.enum(["sandbox", "full-access"]);
const promptRefSchema = promptResourceRefSchema.strict();
const attachmentSchema = promptAttachmentRefSchema.strict();

export const createConversationInputSchema = z
	.object({
		cwd: z.string().trim().min(1),
		prompt: z.string().trim().min(1),
		promptRef: promptRefSchema.optional(),
		attachments: z.array(attachmentSchema).optional(),
		executionMode: executionModeSchema.optional(),
		modelKey: z.string().trim().min(1).optional(),
		reasoning: z.string().trim().min(1).optional(),
		timeoutMs: z.number().int().min(1_000).max(1_800_000).optional(),
	})
	.strict();

export const continueConversationInputSchema = z
	.object({
		sessionPath: z.string().trim().min(1),
		prompt: z.string().trim().min(1),
		promptRef: promptRefSchema.optional(),
		attachments: z.array(attachmentSchema).optional(),
		executionMode: executionModeSchema.optional(),
		modelKey: z.string().trim().min(1).optional(),
		reasoning: z.string().trim().min(1).optional(),
		timeoutMs: z.number().int().min(1_000).max(1_800_000).optional(),
	})
	.strict();

export const listConversationsInputSchema = z
	.object({
		cwd: z.string().trim().min(1),
		limit: z.number().int().min(1).max(200).optional(),
	})
	.strict();

const conversationOperationInputSchema = z
	.object({
		operationId: z.string().uuid(),
	})
	.strict();

export const answerConversationInputSchema = z
	.object({
		operationId: z.string().uuid(),
		interactionId: z.string().uuid(),
		cancelled: z.boolean().optional(),
		answers: z
			.array(
				z
					.object({
						question: z.string().trim().min(1),
						answers: z.array(z.string().trim().min(1)).min(1),
					})
					.strict(),
			)
			.optional(),
	})
	.strict()
	.superRefine((input, context) => {
		if (input.cancelled !== true && input.answers === undefined) {
			context.addIssue({
				code: "custom",
				message: "answers are required unless cancelled is true",
				path: ["answers"],
			});
		}
	});

export const waitConversationInputSchema = conversationOperationInputSchema;
export const abortConversationInputSchema = conversationOperationInputSchema;

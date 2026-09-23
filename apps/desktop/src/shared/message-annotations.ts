import { z } from "zod";

export const ANNOTATION_CHANNELS = {
	LIST: "vetta:annotations:list",
	ASK: "vetta:annotations:ask",
	CANCEL: "vetta:annotations:cancel",
	CHANGED: "vetta:annotations:changed",
} as const;

export const annotationTurnSchema = z.object({
	question: z.string(),
	answer: z.string(),
	status: z.enum(["pending", "completed", "failed", "cancelled", "interrupted"]),
	modelKey: z.string(),
	stopReason: z.enum(["stop", "length"]).optional(),
	usage: z.object({ input: z.number(), output: z.number(), totalTokens: z.number() }).optional(),
});
export const annotationSchema = z.object({
	id: z.uuid(),
	entryId: z.string().min(1),
	quote: z.string(),
	createdAt: z.number(),
	turns: z.array(annotationTurnSchema),
});
export const annotationAskSchema = z
	.object({
		id: z.uuid(),
		entryId: z.string().min(1).max(256),
		quote: z.string().max(20000),
		question: z.string().trim().min(1).max(20000),
		retry: z.boolean().optional(),
	})
	.strict();

export type MessageAnnotation = z.infer<typeof annotationSchema>;
export type AnnotationTurn = z.infer<typeof annotationTurnSchema>;
export type AnnotationAsk = z.infer<typeof annotationAskSchema>;
export interface AnnotationChanged {
	sessionPath: string;
	annotation: MessageAnnotation;
}
export interface MessageAnnotationsApi {
	list(runtimeId: string): Promise<MessageAnnotation[]>;
	ask(runtimeId: string, input: AnnotationAsk): Promise<MessageAnnotation>;
	cancel(runtimeId: string, id: string): Promise<void>;
	onChanged(listener: (event: AnnotationChanged) => void): () => void;
}

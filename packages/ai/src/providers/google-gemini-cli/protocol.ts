import type { ThinkingConfig } from "@google/genai";
import { type Static, Type } from "@sinclair/typebox";
import type { convertMessages, convertTools, mapToolChoice } from "../google-shared.js";
import { geminiResponseChunkSchema } from "../google-stream/response-schema.js";

export interface CloudCodeAssistRequest {
	project: string;
	model: string;
	request: {
		contents: ReturnType<typeof convertMessages>;
		sessionId?: string;
		systemInstruction?: { role?: string; parts: { text: string }[] };
		generationConfig?: {
			maxOutputTokens?: number;
			temperature?: number;
			thinkingConfig?: ThinkingConfig;
		};
		tools?: ReturnType<typeof convertTools>;
		toolConfig?: {
			functionCallingConfig: {
				mode: ReturnType<typeof mapToolChoice>;
			};
		};
	};
	requestType?: string;
	userAgent?: string;
	requestId?: string;
}

export const cloudCodeAssistResponseChunkSchema = Type.Object(
	{
		response: Type.Optional(geminiResponseChunkSchema),
		traceId: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export type CloudCodeAssistResponseChunk = Static<typeof cloudCodeAssistResponseChunkSchema>;

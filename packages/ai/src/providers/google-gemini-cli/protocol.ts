import type { ThinkingConfig } from "@google/genai";
import type { convertMessages, convertTools, mapToolChoice } from "../google-shared.js";

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

export interface CloudCodeAssistResponseChunk {
	response?: {
		candidates?: Array<{
			content?: {
				role: string;
				parts?: Array<{
					text?: string;
					thought?: boolean;
					thoughtSignature?: string;
					functionCall?: {
						name: string;
						args: Record<string, unknown>;
						id?: string;
					};
				}>;
			};
			finishReason?: string;
		}>;
		usageMetadata?: {
			promptTokenCount?: number;
			candidatesTokenCount?: number;
			thoughtsTokenCount?: number;
			totalTokenCount?: number;
			cachedContentTokenCount?: number;
		};
		modelVersion?: string;
		responseId?: string;
	};
	traceId?: string;
}

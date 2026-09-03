import type { DesktopMcpAppAttachment } from "@preload/api";
import type { CardDescriptor } from "@vetta-org/plugin-sdk";

export type ChatErrorKind = "rate_limit" | "quota" | "network" | "auth" | "server" | "unknown";

export interface TextBlock {
	type: "text";
	id: string;
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	id: string;
	text: string;
}

export interface ToolPhaseInfo {
	label: string;
	atMs: number;
}

export interface ToolImagePreview {
	data: string;
	mimeType: string;
	originalPath?: string;
	originalMimeType?: string;
	originalSizeBytes?: number;
	originalWidth?: number;
	originalHeight?: number;
	processedSizeBytes?: number;
	processedWidth?: number;
	processedHeight?: number;
	wasResized?: boolean;
}

export interface ToolAudioPreview {
	data: string;
	mimeType: string;
}

export interface ToolCallUiDetails {
	diff?: string;
	firstChangedLine?: number;
	askUserQuestion?: AskUserQuestionResolution;
	knowledge?: KnowledgeToolUiDetails;
}

export type KnowledgeToolUiDetails =
	| {
			kind: "filter";
			count: number;
			pages: Array<{ id: string; absolutePath: string; title: string; summary: string; tags: string[] }>;
	  }
	| { kind: "tags"; tags: Array<{ tag: string; count: number }> }
	| { kind: "write"; action: string; id: string; absolutePath: string; movedFrom?: string };

export interface QuestionOption {
	readonly label: string;
	readonly description: string;
	readonly badges?: readonly string[];
}

export interface QuestionItem {
	readonly question: string;
	readonly header: string;
	readonly options: readonly QuestionOption[];
	readonly multiSelect?: boolean;
}

export interface QuestionAnswer {
	question: string;
	answers: string[];
}

export interface AskUserQuestionResolution {
	cancelled: boolean;
	answers: QuestionAnswer[];
}

export interface PendingQuestion {
	readonly requestId: string;
	readonly sessionId: string;
	readonly questions: readonly QuestionItem[];
}

export interface ToolCallBlock {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	status: "pending" | "success" | "error";
	result?: string;
	imagePreview?: ToolImagePreview;
	imagePreviews?: ToolImagePreview[];
	audioPreviews?: ToolAudioPreview[];
	mcpApp?: DesktopMcpAppAttachment;
	uiDetails?: ToolCallUiDetails;
	cards?: CardDescriptor[];
	isError?: boolean;
	startedAt?: number;
	durationMs?: number;
	phases?: ToolPhaseInfo[];
	currentPhase?: string;
}

export interface ToolResultBlock {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	content: string;
	isError: boolean;
}

export interface ErrorBlock {
	type: "error";
	id: string;
	turnId?: string;
	text: string;
	kind: ChatErrorKind;
	attempts?: number;
	repeated?: number;
	details?: ChatErrorDetails;
}

export interface ChatErrorDetails {
	code?: string;
	origin?: "runtime" | "provider" | "tool" | "extension";
	retryable?: boolean;
	statusCode?: number;
	provider?: string;
	modelId?: string;
	requestId?: string;
	providerCode?: string;
	phase?: "resolve" | "request" | "response" | "stream" | "decode";
	retryAfterMs?: number;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock | ErrorBlock;

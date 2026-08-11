import type { Static, TSchema } from "@sinclair/typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type {
	ConversationScenario,
	RuntimeContextCompactionResult,
	RuntimeSessionContextUsage,
} from "@vetta/runtime-core";

export interface CodingAgentToolUiDialogOptions {
	readonly signal?: AbortSignal;
	readonly timeout?: number;
}

/** 自定义工具可使用的最小交互能力；复杂 UI 组件继续属于 Extension API。 */
export interface CodingAgentToolUiContext {
	select(title: string, items: string[], options?: CodingAgentToolUiDialogOptions): Promise<string | undefined>;
	confirm(title: string, message: string, options?: CodingAgentToolUiDialogOptions): Promise<boolean>;
	input(title: string, placeholder?: string, options?: CodingAgentToolUiDialogOptions): Promise<string | undefined>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
	onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
	setStatus(key: string, text: string | undefined): void;
	setWorkingMessage(message?: string): void;
	setWidget(
		key: string,
		content: string[] | undefined,
		options?: { readonly placement?: "aboveEditor" | "belowEditor" },
	): void;
	setTitle(title: string): void;
	pasteToEditor(text: string): void;
	setEditorText(text: string): void;
	getEditorText(): string;
	editor(title: string, prefill?: string): Promise<string | undefined>;
	getToolsExpanded(): boolean;
	setToolsExpanded(expanded: boolean): void;
}

export interface CodingAgentToolCompactionOptions {
	readonly customInstructions?: string;
	readonly onComplete?: (result: RuntimeContextCompactionResult) => void;
	readonly onError?: (error: Error) => void;
}

export interface CodingAgentToolPermissionRequest {
	readonly toolName: string;
	readonly toolInput: unknown;
	readonly runIdSuffix: string;
	readonly signal?: AbortSignal;
}

export interface CodingAgentToolPermissionResult {
	readonly decision?: "allow" | "deny";
	readonly message?: string;
}

/** Tool execute 的窄宿主上下文，不公开具体产品管理器或可变注册表。 */
export interface CodingAgentToolExecutionContext {
	readonly ui: CodingAgentToolUiContext;
	readonly hasUI: boolean;
	readonly cwd: string;
	readonly model: Model<Api> | undefined;
	isIdle(): boolean;
	abort(): void;
	hasPendingMessages(): boolean;
	shutdown(): void;
	getContextUsage(): RuntimeSessionContextUsage | undefined;
	compact(options?: CodingAgentToolCompactionOptions): void;
	getSystemPrompt(): string;
	requestEcosystemPermission?(
		request: CodingAgentToolPermissionRequest,
	): Promise<CodingAgentToolPermissionResult | undefined>;
}

export type CodingAgentToolThemeColor =
	| "accent"
	| "border"
	| "borderAccent"
	| "borderMuted"
	| "success"
	| "error"
	| "warning"
	| "muted"
	| "dim"
	| "text"
	| "thinkingText"
	| "userMessageText"
	| "customMessageText"
	| "customMessageLabel"
	| "toolTitle"
	| "toolOutput"
	| "mdHeading"
	| "mdLink"
	| "mdLinkUrl"
	| "mdCode"
	| "mdCodeBlock"
	| "mdCodeBlockBorder"
	| "mdQuote"
	| "mdQuoteBorder"
	| "mdHr"
	| "mdListBullet"
	| "toolDiffAdded"
	| "toolDiffRemoved"
	| "toolDiffContext"
	| "syntaxComment"
	| "syntaxKeyword"
	| "syntaxFunction"
	| "syntaxVariable"
	| "syntaxString"
	| "syntaxNumber"
	| "syntaxType"
	| "syntaxOperator"
	| "syntaxPunctuation"
	| "thinkingOff"
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	| "bashMode";

export type CodingAgentToolThemeBackground =
	| "selectedBg"
	| "userMessageBg"
	| "customMessageBg"
	| "toolPendingBg"
	| "toolSuccessBg"
	| "toolErrorBg";

export interface CodingAgentToolTheme {
	fg(color: CodingAgentToolThemeColor, text: string): string;
	bg(color: CodingAgentToolThemeBackground, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	underline(text: string): string;
	inverse(text: string): string;
	strikethrough(text: string): string;
	getFgAnsi(color: CodingAgentToolThemeColor): string;
	getBgAnsi(color: CodingAgentToolThemeBackground): string;
}

export interface CodingAgentToolRenderComponent {
	render(width: number): string[];
	handleInput?(data: string): void;
	invalidate?(): void;
	dispose?(): void;
}

export interface CodingAgentToolRenderResultOptions {
	readonly expanded: boolean;
	readonly isPartial: boolean;
}

/** 稳定 SDK 的 Session 私有自定义工具定义。 */
export interface CodingAgentSessionToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: TParams;
	readonly scope_use?: readonly ConversationScenario[];
	readonly requires?: readonly string[];
	readonly category?: string;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		context: CodingAgentToolExecutionContext,
	): Promise<AgentToolResult<TDetails>>;
	renderCall?(args: Static<TParams>, theme: CodingAgentToolTheme): CodingAgentToolRenderComponent;
	renderResult?(
		result: AgentToolResult<TDetails>,
		options: CodingAgentToolRenderResultOptions,
		theme: CodingAgentToolTheme,
	): CodingAgentToolRenderComponent;
}

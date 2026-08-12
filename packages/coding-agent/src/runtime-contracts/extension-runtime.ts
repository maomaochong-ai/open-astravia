import type { Extension, ExtensionRunner, RegisteredTool } from "../extensions/index.js";

export const CODING_AGENT_EXTENSION_INPUT_SOURCE_METADATA_KEY = "codingAgentExtensionInputSource";

export type CodingAgentExtensionRunnerPort = Pick<
	ExtensionRunner,
	| "createContext"
	| "emit"
	| "emitBeforeAgentStart"
	| "emitContext"
	| "emitInput"
	| "emitToolCall"
	| "emitToolResult"
	| "hasHandlers"
>;

export type CodingAgentExtensionToolSource = Pick<Extension, "tools">;
export type CodingAgentSessionToolRegistration = RegisteredTool;

export interface CodingAgentExtensionEventBinding {
	readSystemPrompt(): string;
	/** 仅让持有该 Runner 代际 lease 的 Turn 投递执行观察事件。 */
	ownsTurn?(turnId: string): boolean;
	dispose(): Promise<void> | void;
}

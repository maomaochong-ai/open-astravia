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
	dispose(): void;
}

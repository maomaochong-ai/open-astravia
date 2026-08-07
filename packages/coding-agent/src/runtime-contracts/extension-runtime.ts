import type { Extension, ExtensionRunner, RegisteredTool } from "../extensions/index.js";

export const CODING_AGENT_EXTENSION_INPUT_SOURCE_METADATA_KEY = "codingAgentExtensionInputSource";

export type CodingAgentGreenfieldExtensionRunnerPort = Pick<
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

export type CodingAgentGreenfieldExtensionToolSource = Pick<Extension, "tools">;
export type CodingAgentGreenfieldSessionToolRegistration = RegisteredTool;

export interface CodingAgentGreenfieldExtensionEventBinding {
	readSystemPrompt(): string;
	dispose(): void;
}

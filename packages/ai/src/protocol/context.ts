import type { Message } from "./message.js";
import type { Tool } from "./tool.js";

export interface Context {
	systemPrompt?: string;
	/**
	 * Character length of the stable prefix of `systemPrompt`, i.e. the part that stays
	 * byte-identical across turns of a session. Providers that support explicit prompt-cache
	 * breakpoints may split the system prompt here and cache only the prefix.
	 *
	 * `systemPrompt.slice(0, systemPromptStableLength)` plus the remainder always reconstructs
	 * `systemPrompt` exactly. Providers without cache breakpoints ignore this field.
	 */
	systemPromptStableLength?: number;
	messages: Message[];
	tools?: Tool[];
}

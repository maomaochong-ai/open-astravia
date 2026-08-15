import type { Message } from "./message.js";
import type { Tool } from "./tool.js";

export interface PromptCacheSystemPromptBlockSpan {
	id: string;
	/** Zero-based character offset in the rendered `systemPrompt`. */
	start: number;
	/** Character length of this block, excluding inter-block separators. */
	length: number;
	/** Effective provider-prefix classification after the first volatile block. */
	cacheability: "stable" | "volatile";
}

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
	/**
	 * Optional privacy-safe block layout used only to explain cache-prefix changes.
	 * Providers ignore this field; diagnostics hash the referenced slices and never
	 * persist their text.
	 */
	promptCacheSystemPromptBlocks?: readonly PromptCacheSystemPromptBlockSpan[];
	messages: Message[];
	tools?: Tool[];
}

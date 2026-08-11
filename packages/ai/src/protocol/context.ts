import type { Message } from "./message.js";
import type { Tool } from "./tool.js";

export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

import type { AgentMessage } from "@vetta/agent-core";
import type { ImageContent } from "@vetta/ai";

export interface PrintExtensionError {
	readonly extensionPath: string;
	readonly error: unknown;
}

export interface PrintSessionCapabilities {
	readHeader(): unknown | undefined;
	initializeExtensions(onError: (error: PrintExtensionError) => void): Promise<void>;
	subscribe(listener: (event: unknown) => void): () => void;
	prompt(message: string, options?: { readonly images?: readonly ImageContent[] }): Promise<void>;
	readMessages(): readonly AgentMessage[];
}

import type { AgentToolResult, AgentToolUpdateCallback } from "@vetta/agent-core";
import type { TSchema as PiSchema } from "typebox";
import type { ExtensionContext } from "../context-contracts.js";

export const PI_EXTENSION_COMPATIBILITY_PROFILE = "pi-extension-0.84-host-neutral-v1";

export type PiExtensionCompatibilityStatus = "lossless" | "adapted" | "host-dependent" | "excluded" | "unsupported";

export interface PiExtensionCompatibilityFeature {
	readonly feature: string;
	readonly status: PiExtensionCompatibilityStatus;
	readonly detail: string;
}

export interface PiExtensionCompatibilityReport {
	readonly extensionPath: string;
	readonly profile: typeof PI_EXTENSION_COMPATIBILITY_PROFILE;
	readonly features: readonly PiExtensionCompatibilityFeature[];
}

export interface PiCompatibleToolDefinition {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: PiSchema;
	readonly promptSnippet?: string;
	readonly promptGuidelines?: readonly string[];
	readonly prepareArguments?: (input: unknown) => unknown;
	readonly executionMode?: "sequential" | "parallel";
	readonly constrainedSampling?: false | Readonly<Record<string, unknown>>;
	readonly renderCall?: unknown;
	readonly renderResult?: unknown;
	execute(
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<unknown> | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<unknown>>;
}

export interface PiCompatibleExtensionAPI {
	readonly events: unknown;
	on(event: string, handler: (...args: unknown[]) => unknown): void;
	registerTool(tool: PiCompatibleToolDefinition): void;
	registerShortcut(shortcut: string, options: unknown): void;
	registerFlag(name: string, options: unknown): void;
	getFlag(name: string): never;
	registerMessageRenderer(customType: string, renderer: unknown): void;
	registerProvider(name: string, config: unknown): void;
}

export type PiCompatibleExtensionFactory = (api: PiCompatibleExtensionAPI) => void | Promise<void>;

export class PiExtensionCompatibilityError extends Error {
	readonly code = "PI_EXTENSION_UNSUPPORTED";

	constructor(
		readonly feature: string,
		message: string,
	) {
		super(message);
		this.name = "PiExtensionCompatibilityError";
	}
}

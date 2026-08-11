import type { AgentMessage } from "@vetta/agent-core";
import type { ImageContent } from "@vetta/ai";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	InputEvent,
	InputEventResult,
	InputSource,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
} from "../../events/index.js";
import type { ExtensionDispatchEnvironment } from "./dispatch-environment.js";

export interface BeforeAgentStartCombinedResult {
	messages?: NonNullable<BeforeAgentStartEventResult["message"]>[];
	systemPrompt?: string;
}

export interface DiscoveredExtensionResources {
	skillPaths: Array<{ path: string; extensionPath: string }>;
	promptPaths: Array<{ path: string; extensionPath: string }>;
	themePaths: Array<{ path: string; extensionPath: string }>;
}

export class AgentDispatcher {
	constructor(private readonly environment: ExtensionDispatchEnvironment) {}

	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		const context = this.environment.context();
		let currentMessages = structuredClone(messages);
		for (const registration of this.environment.handlers("context")) {
			try {
				const event: ContextEvent = { type: "context", messages: currentMessages };
				const result = (await registration.handler(event, context)) as ContextEventResult | undefined;
				if (result?.messages) currentMessages = result.messages;
			} catch (error) {
				this.environment.report(registration.extensionPath, "context", error);
			}
		}
		return currentMessages;
	}

	async emitBeforeAgentStart(
		prompt: string,
		images: ImageContent[] | undefined,
		systemPrompt: string,
	): Promise<BeforeAgentStartCombinedResult | undefined> {
		const context = this.environment.context();
		const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
		let currentSystemPrompt = systemPrompt;
		let systemPromptModified = false;

		for (const registration of this.environment.handlers("before_agent_start")) {
			try {
				const event: BeforeAgentStartEvent = {
					type: "before_agent_start",
					prompt,
					images,
					systemPrompt: currentSystemPrompt,
				};
				const result = (await registration.handler(event, context)) as BeforeAgentStartEventResult | undefined;
				if (result?.message) messages.push(result.message);
				if (result?.systemPrompt !== undefined) {
					currentSystemPrompt = result.systemPrompt;
					systemPromptModified = true;
				}
			} catch (error) {
				this.environment.report(registration.extensionPath, "before_agent_start", error);
			}
		}

		return messages.length > 0 || systemPromptModified
			? {
					messages: messages.length > 0 ? messages : undefined,
					systemPrompt: systemPromptModified ? currentSystemPrompt : undefined,
				}
			: undefined;
	}

	async emitResourcesDiscover(
		cwd: string,
		reason: ResourcesDiscoverEvent["reason"],
	): Promise<DiscoveredExtensionResources> {
		const context = this.environment.context();
		const resources: DiscoveredExtensionResources = { skillPaths: [], promptPaths: [], themePaths: [] };
		for (const registration of this.environment.handlers("resources_discover")) {
			try {
				const event: ResourcesDiscoverEvent = { type: "resources_discover", cwd, reason };
				const result = (await registration.handler(event, context)) as ResourcesDiscoverResult | undefined;
				if (result?.skillPaths?.length) {
					resources.skillPaths.push(
						...result.skillPaths.map((path) => ({ path, extensionPath: registration.extensionPath })),
					);
				}
				if (result?.promptPaths?.length) {
					resources.promptPaths.push(
						...result.promptPaths.map((path) => ({ path, extensionPath: registration.extensionPath })),
					);
				}
				if (result?.themePaths?.length) {
					resources.themePaths.push(
						...result.themePaths.map((path) => ({ path, extensionPath: registration.extensionPath })),
					);
				}
			} catch (error) {
				this.environment.report(registration.extensionPath, "resources_discover", error);
			}
		}
		return resources;
	}

	async emitInput(text: string, images: ImageContent[] | undefined, source: InputSource): Promise<InputEventResult> {
		const context = this.environment.context();
		let currentText = text;
		let currentImages = images;
		for (const registration of this.environment.handlers("input")) {
			try {
				const event: InputEvent = { type: "input", text: currentText, images: currentImages, source };
				const result = (await registration.handler(event, context)) as InputEventResult | undefined;
				if (result?.action === "handled") return result;
				if (result?.action === "transform") {
					currentText = result.text;
					currentImages = result.images ?? currentImages;
				}
			} catch (error) {
				this.environment.report(registration.extensionPath, "input", error);
			}
		}
		return currentText !== text || currentImages !== images
			? { action: "transform", text: currentText, images: currentImages }
			: { action: "continue" };
	}
}

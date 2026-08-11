import type { ExtensionAPI, ExtensionFactory, MessageRenderer, RegisteredCommand } from "../../api-contracts.js";
import type { ExtensionContext } from "../../context-contracts.js";
import type { EventBus, ExecOptions, KeyId } from "../../infrastructure.js";
import type { ProviderConfig } from "../../provider-contracts.js";
import type { Extension, ExtensionRuntime } from "../../runtime-contracts.js";
import type { ToolDefinition } from "../../tool-contracts.js";
import { resolveExtensionPath } from "../discovery/extension-paths.js";
import { executeExtensionCommand } from "../exec-command.js";
import { loadExtensionFactory } from "../loading/extension-module-loader.js";

type Handler = (...args: unknown[]) => Promise<unknown>;

function createExtension(extensionPath: string, resolvedPath: string): Extension {
	return {
		path: extensionPath,
		resolvedPath,
		handlers: new Map(),
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function createExtensionApi(
	extension: Extension,
	runtime: ExtensionRuntime,
	cwd: string,
	eventBus: EventBus,
): ExtensionAPI {
	return {
		on(event: string, handler: Handler): void {
			const handlers = extension.handlers.get(event) ?? [];
			handlers.push(handler);
			extension.handlers.set(event, handlers);
		},
		registerTool(tool: ToolDefinition): void {
			extension.tools.set(tool.name, { definition: tool, extensionPath: extension.path });
		},
		registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void {
			extension.commands.set(name, { name, ...options });
		},
		registerShortcut(
			shortcut: KeyId,
			options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
		): void {
			extension.shortcuts.set(shortcut, { shortcut, extensionPath: extension.path, ...options });
		},
		registerFlag(
			name: string,
			options: { description?: string; type: "boolean" | "string"; default?: boolean | string },
		): void {
			extension.flags.set(name, { name, extensionPath: extension.path, ...options });
			if (options.default !== undefined && !runtime.flagValues.has(name)) {
				runtime.flagValues.set(name, options.default);
			}
		},
		registerMessageRenderer<T>(customType: string, renderer: MessageRenderer<T>): void {
			extension.messageRenderers.set(customType, renderer as MessageRenderer);
		},
		getFlag(name: string): boolean | string | undefined {
			return extension.flags.has(name) ? runtime.flagValues.get(name) : undefined;
		},
		sendMessage(message, options): void {
			runtime.sendMessage(message, options);
		},
		sendUserMessage(content, options): void {
			runtime.sendUserMessage(content, options);
		},
		appendEntry(customType: string, data?: unknown): void {
			runtime.appendEntry(customType, data);
		},
		setSessionName(name: string): void {
			runtime.setSessionName(name);
		},
		getSessionName(): string | undefined {
			return runtime.getSessionName();
		},
		setLabel(entryId: string, label: string | undefined): void {
			runtime.setLabel(entryId, label);
		},
		exec(command: string, args: string[], options?: ExecOptions) {
			return executeExtensionCommand(command, args, options?.cwd ?? cwd, options);
		},
		getActiveTools: () => runtime.getActiveTools(),
		getAllTools: () => runtime.getAllTools(),
		setActiveTools(toolNames: string[]): void {
			runtime.setActiveTools(toolNames);
		},
		getCommands: () => runtime.getCommands(),
		setModel: (model) => runtime.setModel(model),
		getThinkingLevel: () => runtime.getThinkingLevel(),
		setThinkingLevel(level): void {
			runtime.setThinkingLevel(level);
		},
		registerProvider(name: string, config: ProviderConfig): void {
			runtime.pendingProviderRegistrations.push({ name, config });
		},
		events: eventBus,
	} as ExtensionAPI;
}

export async function loadExtensionFromFactory(
	factory: ExtensionFactory,
	cwd: string,
	eventBus: EventBus,
	runtime: ExtensionRuntime,
	extensionPath = "<inline>",
	resolvedPath = extensionPath,
): Promise<Extension> {
	return registerExtensionFactory(factory, cwd, eventBus, runtime, extensionPath, resolvedPath);
}

async function registerExtensionFactory(
	factory: ExtensionFactory,
	cwd: string,
	eventBus: EventBus,
	runtime: ExtensionRuntime,
	extensionPath: string,
	resolvedPath: string,
): Promise<Extension> {
	const extension = createExtension(extensionPath, resolvedPath);
	await factory(createExtensionApi(extension, runtime, cwd, eventBus));
	return extension;
}

export async function loadExtensionFromPath(
	extensionPath: string,
	cwd: string,
	eventBus: EventBus,
	runtime: ExtensionRuntime,
): Promise<{ extension: Extension | null; error: string | null }> {
	const resolvedPath = resolveExtensionPath(extensionPath, cwd);
	try {
		const factory = await loadExtensionFactory(resolvedPath);
		if (!factory) {
			return { extension: null, error: `Extension does not export a valid factory function: ${extensionPath}` };
		}
		return {
			extension: await registerExtensionFactory(factory, cwd, eventBus, runtime, extensionPath, resolvedPath),
			error: null,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { extension: null, error: `Failed to load extension: ${message}` };
	}
}

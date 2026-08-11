import type { MessageRenderer, RegisteredCommand } from "../../api-contracts.js";
import type { ExtensionKeybindingsConfig, ExtensionResourceDiagnostic, KeyId } from "../../infrastructure.js";
import type { Extension, ExtensionFlag, ExtensionShortcut, RegisteredTool } from "../../runtime-contracts.js";

const RESERVED_ACTIONS = new Set([
	"interrupt",
	"clear",
	"exit",
	"suspend",
	"cycleThinkingLevel",
	"cycleModelForward",
	"cycleModelBackward",
	"selectModel",
	"expandTools",
	"toggleThinking",
	"externalEditor",
	"followUp",
	"submit",
	"selectConfirm",
	"selectCancel",
	"copy",
	"deleteToLineEnd",
]);

export interface ExtensionHandlerRegistration {
	extensionPath: string;
	handler: (...args: unknown[]) => Promise<unknown>;
}

export class ExtensionRegistry {
	private shortcutDiagnostics: ExtensionResourceDiagnostic[] = [];
	private commandDiagnostics: ExtensionResourceDiagnostic[] = [];

	constructor(
		private readonly extensions: Extension[],
		private readonly hasUI: () => boolean,
	) {}

	getPaths(): string[] {
		return this.extensions.map((extension) => extension.path);
	}

	getHandlers(eventType: string): ExtensionHandlerRegistration[] {
		const registrations: ExtensionHandlerRegistration[] = [];
		for (const extension of this.extensions) {
			for (const handler of extension.handlers.get(eventType) ?? []) {
				registrations.push({ extensionPath: extension.path, handler });
			}
		}
		return registrations;
	}

	hasHandlers(eventType: string): boolean {
		return this.extensions.some((extension) => (extension.handlers.get(eventType)?.length ?? 0) > 0);
	}

	getAllTools(): RegisteredTool[] {
		const tools = new Map<string, RegisteredTool>();
		for (const extension of this.extensions) {
			for (const tool of extension.tools.values()) {
				if (!tools.has(tool.definition.name)) tools.set(tool.definition.name, tool);
			}
		}
		return [...tools.values()];
	}

	getToolDefinition(toolName: string): RegisteredTool["definition"] | undefined {
		for (const extension of this.extensions) {
			const tool = extension.tools.get(toolName);
			if (tool) return tool.definition;
		}
		return undefined;
	}

	getFlags(): Map<string, ExtensionFlag> {
		const flags = new Map<string, ExtensionFlag>();
		for (const extension of this.extensions) {
			for (const [name, flag] of extension.flags) {
				if (!flags.has(name)) flags.set(name, flag);
			}
		}
		return flags;
	}

	getMessageRenderer(customType: string): MessageRenderer | undefined {
		for (const extension of this.extensions) {
			const renderer = extension.messageRenderers.get(customType);
			if (renderer) return renderer;
		}
		return undefined;
	}

	getShortcuts(keybindings: ExtensionKeybindingsConfig): Map<KeyId, ExtensionShortcut> {
		this.shortcutDiagnostics = [];
		const builtins = new Map<string, { action: string; restricted: boolean }>();
		for (const [action, keys] of Object.entries(keybindings)) {
			for (const key of Array.isArray(keys) ? keys : [keys]) {
				builtins.set(key.toLowerCase(), { action, restricted: RESERVED_ACTIONS.has(action) });
			}
		}

		const shortcuts = new Map<KeyId, ExtensionShortcut>();
		for (const extension of this.extensions) {
			for (const [key, shortcut] of extension.shortcuts) {
				const normalized = key.toLowerCase();
				const builtin = builtins.get(normalized);
				if (builtin?.restricted) {
					this.addShortcutDiagnostic(
						`Extension shortcut '${key}' from ${shortcut.extensionPath} conflicts with built-in shortcut. Skipping.`,
						shortcut.extensionPath,
					);
					continue;
				}
				if (builtin) {
					this.addShortcutDiagnostic(
						`Extension shortcut conflict: '${key}' is built-in shortcut for ${builtin.action} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
						shortcut.extensionPath,
					);
				}
				const existing = shortcuts.get(normalized);
				if (existing) {
					this.addShortcutDiagnostic(
						`Extension shortcut conflict: '${key}' registered by both ${existing.extensionPath} and ${shortcut.extensionPath}. Using ${shortcut.extensionPath}.`,
						shortcut.extensionPath,
					);
				}
				shortcuts.set(normalized, shortcut);
			}
		}
		return shortcuts;
	}

	getShortcutDiagnostics(): ExtensionResourceDiagnostic[] {
		return this.shortcutDiagnostics;
	}

	getCommands(reserved?: Set<string>): RegisteredCommand[] {
		this.commandDiagnostics = [];
		const commands: RegisteredCommand[] = [];
		const owners = new Map<string, string>();
		for (const extension of this.extensions) {
			for (const command of extension.commands.values()) {
				if (reserved?.has(command.name)) {
					this.addCommandDiagnostic(
						`Extension command '${command.name}' from ${extension.path} conflicts with built-in commands. Skipping.`,
						extension.path,
					);
					continue;
				}
				const owner = owners.get(command.name);
				if (owner) {
					this.addCommandDiagnostic(
						`Extension command '${command.name}' from ${extension.path} conflicts with ${owner}. Skipping.`,
						extension.path,
					);
					continue;
				}
				owners.set(command.name, extension.path);
				commands.push(command);
			}
		}
		return commands;
	}

	getCommandDiagnostics(): ExtensionResourceDiagnostic[] {
		return this.commandDiagnostics;
	}

	getCommandsWithPaths(): Array<{ command: RegisteredCommand; extensionPath: string }> {
		return this.extensions.flatMap((extension) =>
			[...extension.commands.values()].map((command) => ({ command, extensionPath: extension.path })),
		);
	}

	getCommand(name: string): RegisteredCommand | undefined {
		for (const extension of this.extensions) {
			const command = extension.commands.get(name);
			if (command) return command;
		}
		return undefined;
	}

	private addShortcutDiagnostic(message: string, path: string): void {
		this.shortcutDiagnostics.push({ type: "warning", message, path });
		if (!this.hasUI()) console.warn(message);
	}

	private addCommandDiagnostic(message: string, path: string): void {
		this.commandDiagnostics.push({ type: "warning", message, path });
		if (!this.hasUI()) console.warn(message);
	}
}

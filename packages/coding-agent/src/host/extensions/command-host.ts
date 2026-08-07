import type { SlashCommandInfo } from "../../extensions/index.js";
import type {
	CodingAgentExtensionCommandHost as CodingAgentExtensionCommandHostContract,
	CodingAgentExtensionCommandHostOptions,
} from "./contracts.js";

export class CodingAgentExtensionCommandHost implements CodingAgentExtensionCommandHostContract {
	constructor(private readonly options: CodingAgentExtensionCommandHostOptions) {
		options.runner.bindCommandContext(options.actions);
	}

	readCommands(): readonly SlashCommandInfo[] {
		return this.options.runner.getRegisteredCommandsWithPaths().map(({ command, extensionPath }) => ({
			name: command.name,
			description: command.description,
			source: "extension",
			path: extensionPath,
		}));
	}

	async tryExecute(text: string): Promise<boolean> {
		const commandName = readCommandName(text);
		if (commandName === undefined) return false;
		const command = this.options.runner.getCommand(commandName);
		if (!command) return false;

		const spaceIndex = text.indexOf(" ");
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
		try {
			await command.handler(args, this.options.runner.createCommandContext());
		} catch (error) {
			this.options.runner.emitError({
				extensionPath: `command:${commandName}`,
				event: "command",
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return true;
	}

	throwIfExtensionCommand(text: string): void {
		const commandName = readCommandName(text);
		if (commandName === undefined || !this.options.runner.getCommand(commandName)) return;
		throw new Error(
			`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`,
		);
	}
}

export function createCodingAgentExtensionCommandHost(
	options: CodingAgentExtensionCommandHostOptions,
): CodingAgentExtensionCommandHostContract {
	return new CodingAgentExtensionCommandHost(options);
}

function readCommandName(text: string): string | undefined {
	if (!text.startsWith("/")) return undefined;
	const spaceIndex = text.indexOf(" ");
	return spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
}

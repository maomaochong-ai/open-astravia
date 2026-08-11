import chalk from "chalk";
import { type CodingAgentHostBootstrap, createCodingAgentHostBootstrap } from "./coding-agent-host-bootstrap.js";

/** Build the shared CLI host resources without selecting or starting a Session Runtime. */
export async function createAgentCliBootstrap(args: string[]): Promise<CodingAgentHostBootstrap> {
	return createCodingAgentHostBootstrap({
		args,
		onSettingsError: ({ scope, error }) => {
			console.error(chalk.yellow(`Warning (startup, ${scope} settings): ${error.message}`));
			if (error.stack) console.error(chalk.dim(error.stack));
		},
		onExtensionError: ({ path, error }) => {
			console.error(chalk.red(`Failed to load extension "${path}": ${error}`));
		},
	});
}

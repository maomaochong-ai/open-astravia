#!/usr/bin/env node
import { parseDebugCommand, runDebugCommand } from "./debug-command.js";

const command = parseDebugCommand(process.argv.slice(2));
if (!command) {
	process.stderr.write('Expected the first argument to be "debug".\n');
	process.exitCode = 2;
} else {
	process.exitCode = await runDebugCommand(command);
}

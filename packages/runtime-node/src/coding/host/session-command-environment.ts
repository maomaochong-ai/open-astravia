import stripAnsi from "strip-ansi";
import { createNodeCommandToolEnvironment, type NodeCommandToolEnvironment } from "../node-tool-environment.js";
import type { ForegroundCommandOperations } from "../shared/foreground-command-executor.js";
import { sanitizeBinaryOutput } from "../shared/text-decoding.js";
import {
	createNodeBackgroundCommandHost,
	createNodeForegroundCommandHost,
	type NodeShellCommand,
} from "./local-command-host.js";

export interface NodeHostSessionCommandEnvironmentOptions {
	readonly cwd: string;
	readonly resolveShell: () => NodeShellCommand;
	readonly environment?: () => Readonly<Record<string, string | undefined>>;
	readonly sessionEnvironment?: Readonly<Record<string, string>>;
	readonly protectedDirectories?: readonly string[];
	readonly normalizeOutput?: (value: string) => string;
}

export interface NodeHostSessionCommandEnvironment extends NodeCommandToolEnvironment {
	readonly backgroundService: NonNullable<NodeCommandToolEnvironment["backgroundService"]>;
	readonly commandEnvironment: () => Readonly<Record<string, string | undefined>>;
	readonly commandOperations: ForegroundCommandOperations;
	readonly protectedDirectories?: readonly string[];
}

/** Node process implementation for one Session's command tools and background task lifecycle. */
export function createNodeHostSessionCommandEnvironment(
	options: NodeHostSessionCommandEnvironmentOptions,
): NodeHostSessionCommandEnvironment {
	const readBaseEnvironment = options.environment ?? (() => process.env);
	const commandEnvironment = () => ({ ...readBaseEnvironment(), ...options.sessionEnvironment });
	const foregroundCommand = createNodeForegroundCommandHost({
		resolveShell: options.resolveShell,
		environment: commandEnvironment,
		protectedDirectories: options.protectedDirectories,
	});
	const environment = createNodeCommandToolEnvironment({
		cwd: options.cwd,
		foregroundCommand,
		backgroundCommandHost: createNodeBackgroundCommandHost({
			resolveShell: options.resolveShell,
			normalizeOutput: options.normalizeOutput ?? ((value) => sanitizeBinaryOutput(stripAnsi(value))),
		}),
	});
	if (!environment.backgroundService) {
		throw new Error("Node Session command environment requires a background command service");
	}
	return {
		...environment,
		backgroundService: environment.backgroundService,
		commandEnvironment,
		commandOperations: foregroundCommand.operations,
		protectedDirectories: options.protectedDirectories,
	};
}

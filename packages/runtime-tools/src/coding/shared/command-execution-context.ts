import { type PathLiteralCorrection, rewriteQuotedPathLiterals } from "./quoted-path-correction.js";

export interface CommandSpawnContext {
	readonly command: string;
	readonly cwd: string;
	readonly env: NodeJS.ProcessEnv;
}

export type CommandSpawnHook = (context: CommandSpawnContext) => CommandSpawnContext;

export interface CommandExecutionContextOptions {
	readonly environment?: () => NodeJS.ProcessEnv;
	readonly commandPrefix?: string;
	readonly spawnHook?: CommandSpawnHook;
}

export interface ResolvedCommandExecutionContext {
	readonly spawnContext: CommandSpawnContext;
	readonly pathCorrections: readonly PathLiteralCorrection[];
}

export function resolveCommandExecutionContext(
	command: string,
	cwd: string,
	options: CommandExecutionContextOptions,
): ResolvedCommandExecutionContext {
	const prefixedCommand = prependCommandPrefixes(command, [options.commandPrefix]);
	const { output: correctedCommand, pathCorrections } = rewriteQuotedPathLiterals(prefixedCommand, cwd);
	const baseContext: CommandSpawnContext = {
		command: correctedCommand,
		cwd,
		env: { ...(options.environment?.() ?? process.env) },
	};
	return {
		spawnContext: options.spawnHook ? options.spawnHook(baseContext) : baseContext,
		pathCorrections,
	};
}

export function prependPathCorrectionNotes(text: string, corrections: readonly PathLiteralCorrection[]): string {
	if (corrections.length === 0) return text;
	const notes = corrections
		.map(({ original, corrected }) => `[Auto-corrected path: "${original}" -> "${corrected}"]`)
		.join("\n");
	return text ? `${notes}\n${text}` : notes;
}

function prependCommandPrefixes(command: string, prefixes: readonly (string | undefined)[]): string {
	return [...prefixes.filter((prefix): prefix is string => Boolean(prefix?.trim())), command].join("\n");
}

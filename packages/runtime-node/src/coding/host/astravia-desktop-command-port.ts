import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { getAstraviaHomePath } from "@astravia/action-rpc";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	type CommandProcessPort,
	DesktopCommandAbortedError,
	type DesktopCommandPort,
} from "../shared/desktop-command.js";
import { createNodeCommandProcessHost, NodeCommandProcessAbortedError } from "./command-process.js";

const DesktopConfigSchema = Type.Object(
	{ astraviaAppPath: Type.Optional(Type.String({ minLength: 1 })) },
	{ additionalProperties: true },
);

export interface NodeAstraviaDesktopCommandPortOptions {
	readonly commandProcess?: CommandProcessPort;
	readonly platform?: NodeJS.Platform;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly astraviaHomePath?: string;
	readonly fileExists?: (filePath: string) => Promise<boolean>;
	readonly readTextFile?: (filePath: string) => Promise<string>;
}

export function createNodeAstraviaDesktopCommandPort(
	options: NodeAstraviaDesktopCommandPortOptions = {},
): DesktopCommandPort {
	const commandProcess = options.commandProcess ?? createNodeCommandProcessHost();
	const locationOptions: AstraviaExecutableLocationOptions = {
		platform: options.platform ?? process.platform,
		environment: options.environment ?? process.env,
		astraviaHomePath: options.astraviaHomePath,
		fileExists: options.fileExists ?? defaultFileExists,
		readTextFile: options.readTextFile ?? defaultReadTextFile,
	};
	return {
		locate: () => findAstraviaExecutable(locationOptions),
		async run(executable, args, options) {
			try {
				return await commandProcess.run(executable, args, options);
			} catch (error) {
				if (error instanceof NodeCommandProcessAbortedError) throw new DesktopCommandAbortedError();
				throw error;
			}
		},
	};
}

interface AstraviaExecutableLocationOptions {
	readonly platform: NodeJS.Platform;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly astraviaHomePath?: string;
	readonly fileExists: (filePath: string) => Promise<boolean>;
	readonly readTextFile: (filePath: string) => Promise<string>;
}

async function findAstraviaExecutable(
	options: AstraviaExecutableLocationOptions,
): Promise<{ path: string; staleConfiguredPath?: string }> {
	const environmentPath = options.environment.ASTRAVIA_DESKTOP_EXE;
	if (environmentPath && (await options.fileExists(environmentPath))) return { path: environmentPath };
	const configuredPath = await readConfiguredAstraviaAppPath(options);
	if (configuredPath && (await options.fileExists(configuredPath))) return { path: configuredPath };
	const candidates =
		options.platform === "win32"
			? [
					nodePath.join(options.environment.LOCALAPPDATA ?? "", "Programs", "Astravia", "Astravia.exe"),
					nodePath.join(options.environment.ProgramFiles ?? "C:\\Program Files", "Astravia", "Astravia.exe"),
				]
			: ["/Applications/Astravia.app/Contents/MacOS/Astravia", "/usr/local/bin/astravia-desktop"];
	for (const candidate of candidates) {
		if (candidate && (await options.fileExists(candidate))) {
			return { path: candidate, staleConfiguredPath: configuredPath };
		}
	}
	const staleNote = configuredPath ? ` Configured astraviaAppPath is stale: ${configuredPath}` : "";
	throw new Error(
		`Astravia Desktop executable not found. Set ASTRAVIA_DESKTOP_EXE or start Astravia Desktop once to write astraviaAppPath.${staleNote}`,
	);
}

async function readConfiguredAstraviaAppPath(options: AstraviaExecutableLocationOptions): Promise<string | undefined> {
	try {
		const raw = await options.readTextFile(
			nodePath.join(options.astraviaHomePath ?? getAstraviaHomePath(), "desktop-config.json"),
		);
		const parsed: unknown = JSON.parse(raw);
		return Value.Check(DesktopConfigSchema, parsed) ? parsed.astraviaAppPath : undefined;
	} catch {
		return undefined;
	}
}

async function defaultFileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.X_OK);
		return true;
	} catch {
		try {
			await access(filePath, constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}
}

function defaultReadTextFile(filePath: string): Promise<string> {
	return readFile(filePath, "utf8");
}

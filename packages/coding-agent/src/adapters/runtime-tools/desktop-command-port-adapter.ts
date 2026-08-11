import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import nodePath from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getVettaHomePath } from "@vetta/action-rpc";
import {
	type CommandProcessPort,
	DesktopCommandAbortedError,
	type DesktopCommandPort,
} from "@vetta/runtime-tools/coding";
import { CodingAgentCommandProcessAbortedError, createCodingAgentCommandProcessHost } from "./index.js";

const DesktopConfigSchema = Type.Object(
	{ vettaAppPath: Type.Optional(Type.String({ minLength: 1 })) },
	{ additionalProperties: true },
);

export function createCodingAgentDesktopCommandPort(
	commandProcess: CommandProcessPort = createCodingAgentCommandProcessHost(),
): DesktopCommandPort {
	return {
		locate: findVettaExecutable,
		async run(executable, args, options) {
			try {
				return await commandProcess.run(executable, args, options);
			} catch (error) {
				if (error instanceof CodingAgentCommandProcessAbortedError) throw new DesktopCommandAbortedError();
				throw error;
			}
		},
	};
}

async function findVettaExecutable(): Promise<{ path: string; staleConfiguredPath?: string }> {
	const environmentPath = process.env.VETTA_DESKTOP_EXE;
	if (environmentPath && (await fileExists(environmentPath))) return { path: environmentPath };
	const configuredPath = await readConfiguredVettaAppPath();
	if (configuredPath && (await fileExists(configuredPath))) return { path: configuredPath };
	const candidates =
		process.platform === "win32"
			? [
					nodePath.join(process.env.LOCALAPPDATA ?? "", "Programs", "Vetta", "Vetta.exe"),
					nodePath.join(process.env.ProgramFiles ?? "C:\\Program Files", "Vetta", "Vetta.exe"),
				]
			: ["/Applications/Vetta.app/Contents/MacOS/Vetta", "/usr/local/bin/vetta-desktop"];
	for (const candidate of candidates) {
		if (candidate && (await fileExists(candidate))) return { path: candidate, staleConfiguredPath: configuredPath };
	}
	const staleNote = configuredPath ? ` Configured vettaAppPath is stale: ${configuredPath}` : "";
	throw new Error(
		`Vetta Desktop executable not found. Set VETTA_DESKTOP_EXE or start Vetta Desktop once to write vettaAppPath.${staleNote}`,
	);
}

async function readConfiguredVettaAppPath(): Promise<string | undefined> {
	try {
		const raw = await readFile(nodePath.join(getVettaHomePath(), "desktop-config.json"), "utf8");
		const parsed: unknown = JSON.parse(raw);
		return Value.Check(DesktopConfigSchema, parsed) ? parsed.vettaAppPath : undefined;
	} catch {
		return undefined;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
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

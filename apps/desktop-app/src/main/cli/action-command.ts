import { writeSync } from "node:fs";
import { ActionRpcError, createActionRpcClient } from "@vetta/action-rpc";
import { readLocalRpcServerEndpoint } from "../local-rpc/endpoint-file.js";

export type ActionCliCommand =
	| { type: "help" }
	| { type: "error"; code: string; exitCode: number; message: string }
	| { type: "search"; query?: string; domain?: string }
	| { type: "describe"; actionId: string }
	| { type: "run"; actionId: string; input: unknown };

interface ActionCliResponse {
	ok: boolean;
	result?: unknown;
	error?: {
		code: string;
		message: string;
	};
}

const HELP_TEXT = `Vetta action command line interface

Usage:
  Vetta.exe action search [query] [--domain <domain>]
  Vetta.exe action describe <action-id>
  Vetta.exe action run <action-id> [json-input]
  Vetta.exe action -h
  Vetta.exe action --help

Description:
  Operate the running Vetta Desktop app through its local action RPC.
  The GUI must already be running. Do not guess action ids or parameters
  from memory; discover them at runtime.

Progressive discovery (recommended):
  1. search ""                     list available actions (id, title, summary)
  2. search "<intent>"             filter by user intent or domain keyword
  3. describe <action-id>          full input schema, examples, approval info
  4. run <action-id> [json-input]  execute; Desktop may ask the user to approve

  Many actions also support {"operation":"help"} on the matching *.query
  action to return that domain's detailed operation list.

Capability areas (high-level only; live catalog comes from search):
  navigation, appearance, settings, models, mcp, skills, projects,
  batch-tasks, scheduler, knowledge, plugins, im, webhook, downloads, updater

Examples:
  Vetta.exe action search ""
  Vetta.exe action search "model"
  Vetta.exe action describe models.query
  Vetta.exe action run models.query "{\\"operation\\":\\"help\\"}"

JSON input:
  In PowerShell and POSIX shells, wrap the JSON argument in single quotes.
  Keep JSON property names and string values in unescaped double quotes.

Output:
  stdout contains one JSON object:
    {"ok":true,"result":...}
    {"ok":false,"error":{"code":"...","message":"..."}}

Exit codes:
  0  Success or help displayed.
  2  Invalid command line arguments.
  3  Running GUI action server not found or unreachable.
  4  Action RPC error.
`;

class ActionCliError extends Error {
	constructor(
		readonly code: string,
		readonly exitCode: number,
		message: string,
	) {
		super(message);
		this.name = "ActionCliError";
	}
}

function findCommandStart(argv: string[]): number {
	return argv.indexOf("action");
}

function parseSearchOptions(args: string[]): Extract<ActionCliCommand, { type: "search" }> {
	let query: string | undefined;
	let domain: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--domain") {
			const value = args[++i];
			if (!value) throw new ActionCliError("ARGUMENT_ERROR", 2, "--domain requires a value");
			domain = value;
			continue;
		}
		if (arg.startsWith("-")) {
			throw new ActionCliError("ARGUMENT_ERROR", 2, `Unknown option: ${arg}`);
		}
		if (query !== undefined) {
			throw new ActionCliError("ARGUMENT_ERROR", 2, `Unexpected argument: ${arg}`);
		}
		query = arg;
	}
	return { type: "search", query, domain };
}

function stripOuterCliQuotes(raw: string): string | undefined {
	if (raw.length < 2) return undefined;
	const quote = raw[0];
	if ((quote !== "'" && quote !== '"') || raw.at(-1) !== quote) return undefined;
	return raw.slice(1, -1);
}

function unescapeCliDoubleQuotes(raw: string): string | undefined {
	if (!raw.includes('\\"')) return undefined;
	return raw.replaceAll('\\"', '"');
}

function tryParseJsonInput(raw: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(raw) as unknown };
	} catch {
		return { ok: false };
	}
}

function parseJsonInput(raw: string | undefined): unknown {
	if (raw === undefined) return {};
	const rawResult = tryParseJsonInput(raw);
	if (rawResult.ok) return rawResult.value;

	const candidates: string[] = [];
	const unquoted = stripOuterCliQuotes(raw);
	if (unquoted !== undefined) candidates.push(unquoted);
	const unescaped = unescapeCliDoubleQuotes(raw);
	if (unescaped !== undefined) {
		candidates.push(unescaped);
		const unescapedUnquoted = stripOuterCliQuotes(unescaped);
		if (unescapedUnquoted !== undefined) {
			candidates.push(unescapedUnquoted);
		}
	}

	for (const candidate of candidates) {
		const result = tryParseJsonInput(candidate);
		if (result.ok) return result.value;
	}

	throw new ActionCliError("ARGUMENT_ERROR", 2, "json-input must be valid JSON");
}

export function parseActionCliCommand(argv: string[]): ActionCliCommand | null {
	const start = findCommandStart(argv);
	if (start < 0) return null;
	const args = argv.slice(start + 1);
	const subcommand = args[0];

	try {
		if (subcommand === undefined || subcommand === "-h" || subcommand === "--help") {
			return { type: "help" };
		}
		if (subcommand === "search") {
			return parseSearchOptions(args.slice(1));
		}
		if (subcommand === "describe") {
			const actionId = args[1];
			if (!actionId) throw new ActionCliError("ARGUMENT_ERROR", 2, "Missing <action-id>");
			if (args.length > 2) throw new ActionCliError("ARGUMENT_ERROR", 2, `Unexpected argument: ${args[2]}`);
			return { type: "describe", actionId };
		}
		if (subcommand === "run") {
			const actionId = args[1];
			if (!actionId) throw new ActionCliError("ARGUMENT_ERROR", 2, "Missing <action-id>");
			if (args.length > 3) throw new ActionCliError("ARGUMENT_ERROR", 2, `Unexpected argument: ${args[3]}`);
			return { type: "run", actionId, input: parseJsonInput(args[2]) };
		}
		return {
			type: "error",
			code: "ARGUMENT_ERROR",
			exitCode: 2,
			message: `Unknown action subcommand: ${subcommand}`,
		};
	} catch (error) {
		if (error instanceof ActionCliError) {
			return { type: "error", code: error.code, exitCode: error.exitCode, message: error.message };
		}
		const message = error instanceof Error ? error.message : String(error);
		return { type: "error", code: "ARGUMENT_ERROR", exitCode: 2, message };
	}
}

function writeJson(response: ActionCliResponse): void {
	writeSync(1, `${JSON.stringify(response)}\n`);
}

function isConnectionError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed");
}

export async function runActionCliCommand(command: ActionCliCommand): Promise<number> {
	if (command.type === "help") {
		writeSync(1, HELP_TEXT);
		return 0;
	}
	if (command.type === "error") {
		writeJson({ ok: false, error: { code: command.code, message: command.message } });
		return command.exitCode;
	}

	try {
		const client = createActionRpcClient(await readLocalRpcServerEndpoint());
		const result =
			command.type === "search"
				? await client.search({ query: command.query, domain: command.domain })
				: command.type === "describe"
					? await client.describe(command.actionId)
					: await client.run(command.actionId, command.input);
		writeJson({ ok: true, result });
		return 0;
	} catch (error) {
		if (error instanceof ActionRpcError) {
			writeJson({ ok: false, error: { code: error.code, message: error.message } });
			return 4;
		}
		const message = error instanceof Error ? error.message : String(error);
		const code = isConnectionError(error) ? "ACTION_SERVER_UNREACHABLE" : "ACTION_SERVER_NOT_FOUND";
		writeJson({ ok: false, error: { code, message } });
		return 3;
	}
}

import { writeSync } from "node:fs";
import { parseArgs } from "node:util";
import { ActionRpcError, createDebugRpcClient, readActionRpcEndpoint } from "@vetta/action-rpc";
import { z } from "zod";

const debugErrorCommandSchema = z.object({
	type: z.literal("error"),
	code: z.string(),
	exitCode: z.number(),
	message: z.string(),
});
const debugHelpCommandSchema = z.object({ type: z.literal("help") });
const debugSearchCommandSchema = z.object({
	type: z.literal("search"),
	query: z.string().optional(),
	category: z.string().optional(),
});
const debugDescribeCommandSchema = z.object({ type: z.literal("describe"), debugId: z.string() });
const debugRunCommandSchema = z.object({ type: z.literal("run"), debugId: z.string(), input: z.unknown() });
const debugCommandSchema = z.discriminatedUnion("type", [
	debugHelpCommandSchema,
	debugErrorCommandSchema,
	debugSearchCommandSchema,
	debugDescribeCommandSchema,
	debugRunCommandSchema,
]);

type DebugCommand = z.infer<typeof debugCommandSchema>;
type DebugErrorCommand = z.infer<typeof debugErrorCommandSchema>;

const HELP_TEXT = `Vetta Debug command line interface

Usage:
  vetta debug search [query] [--category <category>]
  vetta debug describe <debug-id>
  vetta debug run <debug-id> [json-input]
  vetta debug -h
  vetta debug --help

Description:
  Operate development-only Vetta Debug capabilities through the same local
  RPC server used by Vetta actions. The development Desktop app must already
  be running. Packaged builds do not register the Debug runtime.

Progressive discovery:
  1. search ""                    list available Debug capabilities
  2. search "<intent>"            filter by intent or category keyword
  3. describe <debug-id>          inspect schema and examples
  4. run <debug-id> [json-input]  execute the capability

Examples:
  vetta debug search ""
  vetta debug describe debug.info
  vetta debug run debug.info '{}'

Output:
  stdout contains one JSON object:
    {"ok":true,"result":...}
    {"ok":false,"error":{"code":"...","message":"..."}}
`;

function writeJson(response: unknown): void {
	writeSync(1, `${JSON.stringify(response)}\n`);
}

function argumentError(message: string): DebugErrorCommand {
	return { type: "error", code: "ARGUMENT_ERROR", exitCode: 2, message };
}

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
	try {
		return { ok: true, value: JSON.parse(raw) as unknown };
	} catch {
		return { ok: false };
	}
}

function parseJsonInput(raw: string | undefined): unknown {
	if (raw === undefined) return {};
	const direct = tryParseJson(raw);
	if (direct.ok) return direct.value;
	if (raw.length >= 2 && (raw[0] === "'" || raw[0] === '"') && raw.at(-1) === raw[0]) {
		const unquoted = tryParseJson(raw.slice(1, -1));
		if (unquoted.ok) return unquoted.value;
	}
	const unescaped = tryParseJson(raw.replaceAll('\\"', '"'));
	if (unescaped.ok) return unescaped.value;
	return argumentError("json-input must be valid JSON");
}

function isDebugErrorCommand(value: unknown): value is DebugErrorCommand {
	return debugErrorCommandSchema.safeParse(value).success;
}

function parseSearchCommand(args: string[]): DebugCommand {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args,
			allowPositionals: true,
			options: { category: { type: "string" } },
			strict: true,
		});
	} catch (error) {
		return argumentError(error instanceof Error ? error.message : String(error));
	}
	const [query, unexpected] = parsed.positionals;
	if (unexpected !== undefined) return argumentError(`Unexpected argument: ${unexpected}`);
	return {
		type: "search",
		query,
		category: typeof parsed.values.category === "string" ? parsed.values.category : undefined,
	};
}

export function parseDebugCommand(args: string[]): DebugCommand | undefined {
	if (args[0] !== "debug") return undefined;
	const subcommand = args[1];
	if (subcommand === undefined || subcommand === "-h" || subcommand === "--help") return { type: "help" };
	if (subcommand === "search") return parseSearchCommand(args.slice(2));
	if (subcommand === "describe") {
		if (!args[2]) return argumentError("Missing <debug-id>");
		if (args.length > 3) return argumentError(`Unexpected argument: ${args[3]}`);
		return { type: "describe", debugId: args[2] };
	}
	if (subcommand === "run") {
		if (!args[2]) return argumentError("Missing <debug-id>");
		if (args.length > 4) return argumentError(`Unexpected argument: ${args[4]}`);
		const input = parseJsonInput(args[3]);
		if (isDebugErrorCommand(input)) return input;
		return { type: "run", debugId: args[2], input };
	}
	return argumentError(`Unknown debug subcommand: ${subcommand}`);
}

function isConnectionError(error: unknown): boolean {
	return error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));
}

export async function runDebugCommand(command: DebugCommand): Promise<number> {
	if (command.type === "help") {
		writeSync(1, HELP_TEXT);
		return 0;
	}
	if (command.type === "error") {
		writeJson({ ok: false, error: { code: command.code, message: command.message } });
		return command.exitCode;
	}

	try {
		const client = createDebugRpcClient(await readActionRpcEndpoint());
		const result =
			command.type === "search"
				? await client.search({ query: command.query, category: command.category })
				: command.type === "describe"
					? await client.describe(command.debugId)
					: await client.run(command.debugId, command.input);
		writeJson({ ok: true, result });
		return 0;
	} catch (error) {
		if (error instanceof ActionRpcError) {
			writeJson({ ok: false, error: { code: error.code, message: error.message } });
			return 4;
		}
		const message = error instanceof Error ? error.message : String(error);
		const code = isConnectionError(error) ? "LOCAL_RPC_SERVER_UNREACHABLE" : "LOCAL_RPC_SERVER_NOT_FOUND";
		writeJson({ ok: false, error: { code, message } });
		return 3;
	}
}

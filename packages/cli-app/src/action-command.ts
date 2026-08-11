import { writeSync } from "node:fs";
import { parseArgs } from "node:util";
import { ActionRpcError, createActionRpcClient, readActionRpcEndpoint } from "@vetta/action-rpc";
import { z } from "zod";

const actionErrorCommandSchema = z.object({
	type: z.literal("error"),
	code: z.string(),
	exitCode: z.number(),
	message: z.string(),
});

const actionHelpCommandSchema = z.object({ type: z.literal("help") });
const actionSearchCommandSchema = z.object({
	type: z.literal("search"),
	query: z.string().optional(),
	domain: z.string().optional(),
});
const actionDescribeCommandSchema = z.object({
	type: z.literal("describe"),
	actionId: z.string(),
});
const actionRunCommandSchema = z.object({
	type: z.literal("run"),
	actionId: z.string(),
	input: z.unknown(),
});

const actionCommandSchema = z.discriminatedUnion("type", [
	actionHelpCommandSchema,
	actionErrorCommandSchema,
	actionSearchCommandSchema,
	actionDescribeCommandSchema,
	actionRunCommandSchema,
]);

const searchOptionsSchema = z.object({
	domain: z.string().optional(),
});

type ActionCommand = z.infer<typeof actionCommandSchema>;
type ActionErrorCommand = z.infer<typeof actionErrorCommandSchema>;
type ActionRpcClient = ReturnType<typeof createActionRpcClient>;
type ActionSubcommandDefinition = {
	name: string;
	parse: (args: string[]) => ActionCommand;
	canRun: (command: ActionCommand) => boolean;
	run: (client: ActionRpcClient, command: ActionCommand) => Promise<unknown> | unknown;
};

const HELP_TEXT = `Vetta action command line interface

Usage:
  vetta action search [query] [--domain <domain>]
  vetta action describe <action-id>
  vetta action run <action-id> [json-input]
  vetta action -h
  vetta action --help

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
  vetta action search ""
  vetta action search "model"
  vetta action search "定时" --domain scheduler
  vetta action describe models.query
  vetta action run models.query '{"operation":"help"}'
  vetta action run models.query '{"operation":"list"}'

JSON input:
  In PowerShell and POSIX shells, wrap the JSON argument in single quotes.
  Keep JSON property names and string values in unescaped double quotes.

Output:
  stdout contains one JSON object:
    {"ok":true,"result":...}
    {"ok":false,"error":{"code":"...","message":"..."}}
`;

function writeJson(response: unknown): void {
	writeSync(1, `${JSON.stringify(response)}\n`);
}

function argumentError(message: string): ActionErrorCommand {
	return {
		type: "error",
		code: "ARGUMENT_ERROR",
		exitCode: 2,
		message,
	};
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

function parseJsonInput(raw: string | undefined): ActionCommand | unknown {
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

	return argumentError("json-input must be valid JSON");
}

function isActionErrorCommand(value: unknown): value is Extract<ActionCommand, { type: "error" }> {
	return actionErrorCommandSchema.safeParse(value).success;
}

function parseRequiredSingleArgument(args: string[], argumentName: string): string | ActionErrorCommand {
	const value = args[0];
	if (!value) return argumentError(`Missing <${argumentName}>`);
	if (args.length > 1) return argumentError(`Unexpected argument: ${args[1]}`);
	return value;
}

function formatParseArgsError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const optionName = "optionName" in error && typeof error.optionName === "string" ? error.optionName : undefined;
	if (error.message.includes("does not take an argument") && optionName) return `Unknown option: ${optionName}`;
	if (error.message.includes("requires a value") && optionName) return `${optionName} requires a value`;
	return error.message;
}

function parseSearchCommand(args: string[]): ActionCommand {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args,
			allowPositionals: true,
			options: {
				domain: { type: "string" },
			},
			strict: true,
		});
	} catch (error) {
		return argumentError(formatParseArgsError(error));
	}

	const [query, unexpected] = parsed.positionals;
	if (unexpected !== undefined) {
		return argumentError(`Unexpected argument: ${unexpected}`);
	}
	const options = searchOptionsSchema.parse(parsed.values);
	return { type: "search", query, domain: options.domain };
}

function parseDescribeCommand(args: string[]): ActionCommand {
	const actionId = parseRequiredSingleArgument(args, "action-id");
	if (isActionErrorCommand(actionId)) return actionId;
	return { type: "describe", actionId };
}

function parseRunCommand(args: string[]): ActionCommand {
	const actionId = args[0];
	if (!actionId) return argumentError("Missing <action-id>");
	if (args.length > 2) return argumentError(`Unexpected argument: ${args[2]}`);
	const input = parseJsonInput(args[1]);
	if (isActionErrorCommand(input)) return input;
	return { type: "run", actionId, input };
}

const actionSubcommands: ActionSubcommandDefinition[] = [
	{
		name: "search",
		parse: parseSearchCommand,
		canRun: (command) => actionSearchCommandSchema.safeParse(command).success,
		run: (client, command) => {
			const parsed = actionSearchCommandSchema.parse(command);
			return client.search({ query: parsed.query, domain: parsed.domain });
		},
	},
	{
		name: "describe",
		parse: parseDescribeCommand,
		canRun: (command) => actionDescribeCommandSchema.safeParse(command).success,
		run: (client, command) => {
			const parsed = actionDescribeCommandSchema.parse(command);
			return client.describe(parsed.actionId);
		},
	},
	{
		name: "run",
		parse: parseRunCommand,
		canRun: (command) => actionRunCommandSchema.safeParse(command).success,
		run: (client, command) => {
			const parsed = actionRunCommandSchema.parse(command);
			return client.run(parsed.actionId, parsed.input);
		},
	},
];

export function parseActionCommand(args: string[]): ActionCommand | undefined {
	if (args[0] !== "action") return undefined;
	const subcommand = args[1];
	if (subcommand === undefined || subcommand === "-h" || subcommand === "--help") {
		return { type: "help" };
	}

	const definition = actionSubcommands.find((candidate) => candidate.name === subcommand);
	if (!definition) return argumentError(`Unknown action subcommand: ${subcommand}`);
	return definition.parse(args.slice(2));
}

function isConnectionError(error: unknown): boolean {
	return error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));
}

export async function runActionCommand(command: ActionCommand): Promise<number> {
	if (command.type === "help") {
		writeSync(1, HELP_TEXT);
		return 0;
	}
	if (command.type === "error") {
		writeJson({ ok: false, error: { code: command.code, message: command.message } });
		return command.exitCode;
	}

	try {
		const client = createActionRpcClient(await readActionRpcEndpoint());
		const definition = actionSubcommands.find((candidate) => candidate.canRun(command));
		if (!definition) throw new Error(`Unhandled action command: ${command.type}`);
		const result = await definition.run(client, command);
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

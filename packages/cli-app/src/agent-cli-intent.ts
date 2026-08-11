export type AgentCliIntent = "control" | "print" | "rpc";

const CONTROL_FLAGS = new Set(["--help", "-h", "--version", "-v", "--list-models", "--export"]);
const PACKAGE_COMMANDS = new Set(["install", "remove", "update", "list"]);

/** Classify CLI orchestration without parsing provider, Extension, or Session options. */
export function classifyAgentCliIntent(args: readonly string[]): AgentCliIntent {
	if (args.some((arg) => CONTROL_FLAGS.has(arg)) || PACKAGE_COMMANDS.has(args[0] ?? "")) return "control";
	if (requestsRpcMode(args)) return "rpc";
	// No-mode invocations remain print-compatible because piped stdin is only
	// observable after the Legacy CLI starts reading its input stream.
	return "print";
}

function requestsRpcMode(args: readonly string[]): boolean {
	return args.some((arg, index) => arg === "--mode=rpc" || (arg === "--mode" && args[index + 1] === "rpc"));
}

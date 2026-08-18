import { classifyAgentCliIntent } from "./agent-cli-intent.js";
import { type RunAgentRuntimeCliOptions, runAgentRuntimeCli } from "./agent-runtime-selection.js";
import { installRpcStdoutGuard } from "./rpc/rpc-stdout-guard.js";

export type RunAgentCliOptions = Pick<RunAgentRuntimeCliOptions, "htmlExporter">;

export async function runAgentCli(args: readonly string[], options: RunAgentCliOptions = {}): Promise<void> {
	const intent = classifyAgentCliIntent(args);
	if (intent === "rpc") {
		installRpcStdoutGuard();
	}
	await runAgentRuntimeCli(args, options);
}

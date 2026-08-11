import type { AgentLoopConfig, StreamFn } from "@vetta/agent-core";
import type { Api, Model, SimpleStreamOptions } from "@vetta/ai";

export interface AgentCoreTurnEngineOptions {
	/** Compatibility fallback; production Runtime should bind the model per turn. */
	readonly model?: Model<Api>;
	readonly streamOptions?: Omit<SimpleStreamOptions, "sessionId" | "signal">;
	readonly streamFn?: StreamFn;
	readonly getApiKey?: AgentLoopConfig["getApiKey"];
	/** Platform-neutral observation port owned and disposed by the host. */
	readonly tracer?: AgentLoopConfig["tracer"];
	/** Shared tracing policy; execute supplies the concrete session identity. */
	readonly tracing?: AgentLoopConfig["tracing"];
	/** Finite model, tool, and checkpoint budgets applied to every turn. */
	readonly limits?: AgentLoopConfig["limits"];
	/** Resolves credentials for the exact model bound to the current turn. */
	readonly resolveApiKey?: (model: Model<Api>) => Promise<string | undefined> | string | undefined;
}

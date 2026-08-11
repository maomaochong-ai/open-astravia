import type { PrintExtensionError, PrintSessionCapabilities } from "@vetta/coding-agent/bootstrap";
import {
	type CodingAgentTurnExecutor,
	createCodingAgentRuntimeExtensionObservationAdapter,
	projectCodingAgentRuntimeMessages,
} from "@vetta/coding-agent/runtime";
import type { RuntimeSession, RuntimeSessionExecutionObservation, SessionEvent } from "@vetta/runtime-core";

interface PrintSessionHost {
	readonly turnExecutor: Pick<CodingAgentTurnExecutor, "prompt">;
	readSession(): RuntimeSession;
	initializeExtensions(input: { readonly onError: (error: PrintExtensionError) => void }): Promise<void>;
	subscribe(listener: (event: SessionEvent) => void): () => void;
	subscribeExecutionObservations(
		listener: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void;
	subscribeRetryEvents(listener: (event: unknown) => void): () => void;
	dispose(): Promise<void>;
}

interface PrintSessionAdapterOptions {
	readonly sessionHost: PrintSessionHost;
}

/** Runtime 到既有单次 Print 合同的产品宿主适配器。 */
export class CliPrintSessionAdapter implements PrintSessionCapabilities {
	constructor(private readonly options: PrintSessionAdapterOptions) {}

	readHeader(): unknown {
		const identity = this.readDocument().identity;
		return {
			type: "session",
			version: 3,
			id: identity.sessionId,
			timestamp: new Date(identity.createdAt).toISOString(),
			cwd: identity.cwd ?? process.cwd(),
			...(identity.parentSessionPath ? { parentSession: identity.parentSessionPath } : {}),
			...(identity.parentEntryId ? { parentEntryId: identity.parentEntryId } : {}),
		};
	}

	async initializeExtensions(onError: (error: PrintExtensionError) => void): Promise<void> {
		await this.options.sessionHost.initializeExtensions({ onError });
	}

	subscribe(listener: (event: unknown) => void): () => void {
		const observationAdapter = createCodingAgentRuntimeExtensionObservationAdapter(async (event) => listener(event));
		const removeObservations = this.options.sessionHost.subscribeExecutionObservations((observation) =>
			observationAdapter.observe(observation),
		);
		const removeSessionEvents = this.options.sessionHost.subscribe((event) => {
			const mapped = mapSupplementalSessionEvent(event);
			if (mapped) listener(mapped);
		});
		const removeRetryEvents = this.options.sessionHost.subscribeRetryEvents(listener);
		return () => {
			removeRetryEvents();
			removeSessionEvents();
			removeObservations();
		};
	}

	async prompt(message: string, options?: Parameters<PrintSessionCapabilities["prompt"]>[1]): Promise<void> {
		await this.options.sessionHost.turnExecutor.prompt(message, {
			images: options?.images,
			throwOnFailure: false,
		});
	}

	readMessages(): ReturnType<PrintSessionCapabilities["readMessages"]> {
		return projectCodingAgentRuntimeMessages(this.readDocument());
	}

	dispose(): Promise<void> {
		return this.options.sessionHost.dispose();
	}

	private readDocument() {
		return this.options.sessionHost.readSession().createCoreAssembly().conversationView.readDocument();
	}
}

function mapSupplementalSessionEvent(event: SessionEvent): unknown | undefined {
	switch (event.type) {
		case "session.path_changed":
			return event.path
				? { type: "session_path_changed", from: event.previousPath, to: event.path, reason: event.reason }
				: undefined;
		case "compaction.start":
			return { type: "auto_compaction_start", reason: event.reason };
		case "compaction.end":
			return {
				type: "auto_compaction_end",
				result: undefined,
				aborted: false,
				willRetry: false,
				...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
			};
		case "todo_update":
			return { type: "todo_update", items: event.items };
		case "background_tasks_update":
			return { type: "background_tasks_update", tasks: event.tasks };
		case "subagents_update":
			return { type: "subagents_update", agents: event.agents };
		case "mcp.reload.start":
			return { type: "mcp_reload_start" };
		case "mcp.reload.end":
			return {
				type: "mcp_reload_end",
				changed: event.changed,
				...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
			};
		default:
			return undefined;
	}
}

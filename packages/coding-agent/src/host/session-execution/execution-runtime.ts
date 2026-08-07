import {
	type GreenfieldRuntimeResourceContext,
	type RuntimeExecutionModeUpdate,
	type RuntimeSessionExecutionController,
	RuntimeSessionHostInteractionBroker,
	type SessionExecutionMode,
} from "@vetta/runtime-core";
import type { AgentFeatureDefinition, AgentSession, CapabilityBinding } from "@vetta/runtime-core/kernel";
import {
	type BackgroundCommandService,
	buildBackgroundCommandNotification,
	CODING_TOOL_AVAILABILITY_ERROR_CODES,
	type CodingToolActivation,
	CodingToolAvailabilityError,
	type CodingToolAvailabilityErrorCode,
	type CodingToolCatalog,
	type CodingToolCatalogEntry,
	type CodingToolCatalogSnapshot,
	type CodingToolRegistration,
	createBackgroundCommandService,
	createBackgroundCommandToolExecutor,
	createBashToolRegistration,
	createCodingToolsFeature,
	createForegroundCommandToolExecutor,
	createShellToolRegistration,
	createTaskOutputToolRegistration,
	createTaskStopToolRegistration,
	guardCodingToolRegistration,
	InMemoryCodingToolRegistry,
} from "@vetta/runtime-tools/coding";
import {
	createCodingAgentBackgroundCommandHost,
	createCodingAgentForegroundCommandHost,
} from "../../adapters/runtime-tools/index.js";
import { createCodingAgentSandboxToolRegistrations } from "./sandbox-tool-registrations.js";

const SESSION_EXECUTION_FEATURE_ID = "coding-session-execution-tools";

export interface CodingAgentSessionExecutionRuntimeOptions {
	readonly cwd: string;
	readonly activation: CodingToolActivation;
	readonly enableBackgroundTasks?: boolean;
	readonly initialMode?: SessionExecutionMode;
	readonly env?: Readonly<Record<string, string>>;
	readonly sandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly readSessionId: () => string;
	readonly resolveToolEntry?: (toolName: string) => CodingToolCatalogEntry | undefined;
	readonly resourceContext: GreenfieldRuntimeResourceContext;
}

/** Session-local 的命令、后台任务、sandbox 与宿主交互组合。 */
export class CodingAgentSessionExecutionRuntime {
	readonly backgroundService: BackgroundCommandService;
	readonly hostInteraction = new RuntimeSessionHostInteractionBroker();
	readonly feature: AgentFeatureDefinition;
	private readonly catalog: SwappableCodingToolCatalog;
	private disposeTaskEvents: (() => void) | undefined;
	private disposeTaskNotifications: (() => void) | undefined;
	private readonly fullAccessRegistrations: readonly CodingToolRegistration[];
	private readonly sourceBindings = new Map<string, CapabilityBinding | undefined>();
	private mode: SessionExecutionMode;

	constructor(private readonly options: CodingAgentSessionExecutionRuntimeOptions) {
		this.mode = options.initialMode ?? "full-access";
		const commandHost = createCodingAgentForegroundCommandHost(options.cwd);
		const environment = commandHost.environment;
		const sessionCommandHost = {
			...commandHost,
			environment: () => ({ ...environment(), ...options.env }),
		};
		this.backgroundService = createBackgroundCommandService(createCodingAgentBackgroundCommandHost());
		const foregroundExecutor = createForegroundCommandToolExecutor(sessionCommandHost);
		const commandExecutor = createBackgroundCommandToolExecutor({
			...sessionCommandHost,
			foregroundExecutor,
			backgroundService: this.backgroundService,
		});
		this.fullAccessRegistrations = [
			createBashToolRegistration(options.cwd, { executor: commandExecutor }),
			createShellToolRegistration(options.cwd, { executor: commandExecutor }),
			createTaskOutputToolRegistration({ backgroundService: this.backgroundService }),
			createTaskStopToolRegistration({ backgroundService: this.backgroundService }),
		].map((registration) => inheritModelOrder(registration, options.resolveToolEntry?.(registration.tool.name)));
		for (const toolName of SESSION_EXECUTION_TOOL_NAMES) {
			this.sourceBindings.set(toolName, options.resolveToolEntry?.(toolName)?.binding);
		}
		const initialRegistry = new InMemoryCodingToolRegistry(
			this.buildModeRegistrations(this.mode, this.fullAccessRegistrations, {
				mode: this.mode,
				sessionId: options.readSessionId(),
				sandboxHostPath: options.sandboxHostPath,
				linuxBubblewrapPath: options.linuxBubblewrapPath,
				macosSandboxExecPath: options.macosSandboxExecPath,
			}),
			{ sourceId: "coding-session-execution-tools" },
		);
		this.catalog = new SwappableCodingToolCatalog(initialRegistry, (toolName) =>
			this.resolveAvailabilityErrorCode(toolName),
		);
		this.feature = createCodingToolsFeature({
			id: SESSION_EXECUTION_FEATURE_ID,
			catalog: this.catalog,
			activation: withBackgroundTaskCapability(options.activation, options.enableBackgroundTasks !== false),
			filterRegistration: (registration) =>
				this.isEnabled(registration.tool.name) &&
				this.resolveAvailabilityErrorCode(registration.tool.name) === undefined,
		});
		this.bindBackgroundTaskObservers();
	}

	createExecutionController(session: AgentSession): RuntimeSessionExecutionController {
		return {
			isBusy: () => session.state === "running" || session.state === "cancelling",
			reconfigure: async (update) => {
				const registrations = this.buildModeRegistrations(update.mode, this.fullAccessRegistrations, update);
				const next = new InMemoryCodingToolRegistry(registrations, {
					sourceId: "coding-session-execution-tools",
				});
				this.catalog.swap(next);
				this.mode = update.mode;
			},
		};
	}

	async quiesceBackgroundCommands(): Promise<void> {
		this.unbindBackgroundTaskObservers();
		try {
			await this.backgroundService.shutdown();
		} finally {
			this.bindBackgroundTaskObservers();
		}
	}

	private bindBackgroundTaskObservers(): void {
		this.disposeTaskEvents = this.backgroundService.subscribe(() => {
			void this.options.resourceContext
				.reportObservation({
					type: "background_tasks_update",
					tasks: this.backgroundService.list(),
					source: "tool",
				})
				.catch((error: unknown) => {
					console.warn("[greenfield-runtime] failed to publish background task observation", error);
				});
		});
		this.disposeTaskNotifications = this.backgroundService.subscribeNotifications((task) => {
			void this.options.resourceContext
				.deliverAsyncContext([
					{
						type: "task-notification",
						content: [{ type: "text", text: buildBackgroundCommandNotification(task) }],
						modelVisible: true,
						display: true,
					},
				])
				.catch((error: unknown) => {
					console.warn("[greenfield-runtime] failed to deliver background task notification", error);
				});
		});
	}

	private unbindBackgroundTaskObservers(): void {
		this.disposeTaskNotifications?.();
		this.disposeTaskNotifications = undefined;
		this.disposeTaskEvents?.();
		this.disposeTaskEvents = undefined;
	}

	readMode(): SessionExecutionMode {
		return this.mode;
	}

	readRegistrations(): readonly CodingToolRegistration[] {
		return this.catalog.snapshot().registrations;
	}

	readAvailableTools(): ReadonlyMap<string, CodingToolRegistration["tool"]> {
		return new Map(
			this.catalog
				.snapshot()
				.entries.map(
					(entry) => [entry.registration.tool.name, guardCodingToolRegistration(this.catalog, entry)] as const,
				)
				.filter(
					([toolName]) => this.isEnabled(toolName) && this.resolveAvailabilityErrorCode(toolName) === undefined,
				),
		);
	}

	ownsTool(toolName: string): boolean {
		if (!this.catalog.resolve(toolName)) return false;
		if (!this.options.resolveToolEntry) return true;
		const sourceBinding = this.sourceBindings.get(toolName);
		if (!sourceBinding) return false;
		const current = this.options.resolveToolEntry(toolName);
		return current === undefined || sameBinding(sourceBinding, current.binding);
	}

	async dispose(): Promise<void> {
		this.unbindBackgroundTaskObservers();
		await this.backgroundService.shutdown();
	}

	private resolveAvailabilityErrorCode(toolName: string): CodingToolAvailabilityErrorCode | undefined {
		const resolveToolEntry = this.options.resolveToolEntry;
		if (!resolveToolEntry) return undefined;
		const sourceBinding = this.sourceBindings.get(toolName);
		const current = resolveToolEntry(toolName);
		if (!sourceBinding || !current) return CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE;
		if (current.state === "revoked") return CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED;
		if (!sameBinding(sourceBinding, current.binding)) {
			return CODING_TOOL_AVAILABILITY_ERROR_CODES.DEFINITION_CHANGED;
		}
		if (current.state === "deactivated") return CODING_TOOL_AVAILABILITY_ERROR_CODES.DEACTIVATED;
		return undefined;
	}

	private isEnabled(toolName: string): boolean {
		return this.options.enableBackgroundTasks !== false || !BACKGROUND_TASK_TOOL_NAMES.has(toolName);
	}

	private buildModeRegistrations(
		mode: SessionExecutionMode,
		fullAccessRegistrations: readonly CodingToolRegistration[],
		update: RuntimeExecutionModeUpdate,
	): readonly CodingToolRegistration[] {
		const taskRegistrations = fullAccessRegistrations.filter(
			({ tool }) => tool.name === "task_output" || tool.name === "task_stop",
		);
		if (mode === "full-access") return fullAccessRegistrations;
		return [
			...createCodingAgentSandboxToolRegistrations({
				cwd: this.options.cwd,
				hostInteraction: this.hostInteraction,
				windowsSandboxHostPath: update.sandboxHostPath,
				linuxBubblewrapPath: update.linuxBubblewrapPath,
				macosSandboxExecPath: update.macosSandboxExecPath,
				getSessionId: this.options.readSessionId,
			}),
			...taskRegistrations,
		];
	}
}

class SwappableCodingToolCatalog implements CodingToolCatalog {
	constructor(
		private current: InMemoryCodingToolRegistry,
		private readonly resolveAvailabilityErrorCode: (toolName: string) => CodingToolAvailabilityErrorCode | undefined,
	) {}

	swap(next: InMemoryCodingToolRegistry): void {
		this.current = next;
	}

	snapshot(): CodingToolCatalogSnapshot {
		return this.current.snapshot();
	}

	resolve(toolName: string): CodingToolCatalogEntry | undefined {
		return this.current.resolve(toolName);
	}

	async execute(
		binding: Parameters<CodingToolCatalog["execute"]>[0],
		request: Parameters<CodingToolCatalog["execute"]>[1],
	): ReturnType<CodingToolCatalog["execute"]> {
		const errorCode = this.resolveAvailabilityErrorCode(binding.capabilityId);
		if (errorCode) throw new CodingToolAvailabilityError(errorCode, binding);
		return this.current.execute(binding, request);
	}
}

const SESSION_EXECUTION_TOOL_NAMES = ["bash", "shell", "read", "write", "edit", "task_output", "task_stop"] as const;
const BACKGROUND_TASK_TOOL_NAMES = new Set<string>(["task_output", "task_stop"]);

function inheritModelOrder(
	registration: CodingToolRegistration,
	source: CodingToolCatalogEntry | undefined,
): CodingToolRegistration {
	const modelOrder = source?.registration.modelOrder;
	return modelOrder === undefined
		? registration
		: { ...registration, modelOrder, tool: { ...registration.tool, modelOrder } };
}

function withBackgroundTaskCapability(activation: CodingToolActivation, enabled: boolean): CodingToolActivation {
	if (!enabled || activation.mode === "explicit") return activation;
	return {
		...activation,
		capabilities: new Set([...(activation.capabilities ?? []), "bg-tasks"]),
	};
}

function sameBinding(left: CapabilityBinding, right: CapabilityBinding): boolean {
	return (
		left.sourceId === right.sourceId && left.capabilityId === right.capabilityId && left.revision === right.revision
	);
}

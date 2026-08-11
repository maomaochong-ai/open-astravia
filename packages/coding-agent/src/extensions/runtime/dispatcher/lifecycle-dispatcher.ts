import type {
	BeforeAgentStartEvent,
	ContextEvent,
	ExtensionEvent,
	InputEvent,
	ResourcesDiscoverEvent,
	SessionBeforeCompactResult,
	SessionBeforeForkResult,
	SessionBeforeSwitchResult,
	SessionBeforeTreeResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	UserBashEvent,
	UserBashEventResult,
} from "../../events/index.js";
import type { ExtensionDispatchEnvironment } from "./dispatch-environment.js";

export type RunnerEmitEvent = Exclude<
	ExtensionEvent,
	| ToolCallEvent
	| ToolResultEvent
	| UserBashEvent
	| ContextEvent
	| BeforeAgentStartEvent
	| ResourcesDiscoverEvent
	| InputEvent
>;

type SessionBeforeEvent = Extract<
	RunnerEmitEvent,
	{ type: "session_before_switch" | "session_before_fork" | "session_before_compact" | "session_before_tree" }
>;

type SessionBeforeEventResult =
	| SessionBeforeSwitchResult
	| SessionBeforeForkResult
	| SessionBeforeCompactResult
	| SessionBeforeTreeResult;

export type RunnerEmitResult<TEvent extends RunnerEmitEvent> = TEvent extends { type: "session_before_switch" }
	? SessionBeforeSwitchResult | undefined
	: TEvent extends { type: "session_before_fork" }
		? SessionBeforeForkResult | undefined
		: TEvent extends { type: "session_before_compact" }
			? SessionBeforeCompactResult | undefined
			: TEvent extends { type: "session_before_tree" }
				? SessionBeforeTreeResult | undefined
				: undefined;

function isSessionBeforeEvent(event: RunnerEmitEvent): event is SessionBeforeEvent {
	return (
		event.type === "session_before_switch" ||
		event.type === "session_before_fork" ||
		event.type === "session_before_compact" ||
		event.type === "session_before_tree"
	);
}

export class LifecycleDispatcher {
	constructor(private readonly environment: ExtensionDispatchEnvironment) {}

	async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
		const context = this.environment.context();
		let result: SessionBeforeEventResult | undefined;
		for (const registration of this.environment.handlers(event.type)) {
			try {
				const handlerResult = await registration.handler(event, context);
				if (isSessionBeforeEvent(event) && handlerResult) {
					result = handlerResult as SessionBeforeEventResult;
					if (result.cancel) return result as RunnerEmitResult<TEvent>;
				}
			} catch (error) {
				this.environment.report(registration.extensionPath, event.type, error);
			}
		}
		return result as RunnerEmitResult<TEvent>;
	}

	async emitToolCall(event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
		const context = this.environment.context();
		let result: ToolCallEventResult | undefined;
		for (const registration of this.environment.handlers("tool_call")) {
			const handlerResult = await registration.handler(event, context);
			if (handlerResult) {
				result = handlerResult as ToolCallEventResult;
				if (result.block) return result;
			}
		}
		return result;
	}

	async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		const context = this.environment.context();
		const currentEvent: ToolResultEvent = { ...event };
		let modified = false;
		for (const registration of this.environment.handlers("tool_result")) {
			try {
				const result = (await registration.handler(currentEvent, context)) as ToolResultEventResult | undefined;
				if (!result) continue;
				if (result.content !== undefined) {
					currentEvent.content = result.content;
					modified = true;
				}
				if (result.details !== undefined) {
					currentEvent.details = result.details;
					modified = true;
				}
				if (result.isError !== undefined) {
					currentEvent.isError = result.isError;
					modified = true;
				}
			} catch (error) {
				this.environment.report(registration.extensionPath, "tool_result", error);
			}
		}
		return modified
			? { content: currentEvent.content, details: currentEvent.details, isError: currentEvent.isError }
			: undefined;
	}

	async emitUserBash(event: UserBashEvent): Promise<UserBashEventResult | undefined> {
		const context = this.environment.context();
		for (const registration of this.environment.handlers("user_bash")) {
			try {
				const result = await registration.handler(event, context);
				if (result) return result as UserBashEventResult;
			} catch (error) {
				this.environment.report(registration.extensionPath, "user_bash", error);
			}
		}
		return undefined;
	}
}

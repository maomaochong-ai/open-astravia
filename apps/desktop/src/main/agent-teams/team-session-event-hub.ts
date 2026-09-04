import {
	correlateTeamMemberToolExecution,
	type TeamObservationPublisher,
	type TeamSessionDocument,
} from "@vetta/agent-team";
import { type AssistantMessage, type AssistantMessageEvent, createAssistantMessage } from "@vetta/ai";
import type { RuntimeHost, RuntimeSessionExecutionObservation, SessionEvent } from "@vetta/runtime-core";
import type { ConversationMessageStreamEvent } from "@vetta/runtime-core/conversation";
import type {
	DesktopTeamContextUsageEvent,
	DesktopTeamSessionStreamEvent,
	DesktopTeamToolExecutionEvent,
} from "../../preload/api-types/team-conversation-display.js";
import { isPublicAssistantPart, publicAssistantMessage } from "./team-public-message.js";

export interface ActiveTeamMemberTurn {
	readonly teamSessionId: string;
	readonly memberId: string;
	readonly requestId: string;
	readonly turnId: string;
	readonly messageId: string;
	readonly author: { readonly kind: "agent"; readonly id: string; readonly agentId?: string };
	readonly workItemId: string;
	readonly attemptId: string;
	readonly deliveryId?: string;
	readonly startedAt: number;
	seq: number;
	text: string;
	rawAssistantStream: boolean;
	latestPublicPartial?: AssistantMessage;
}

interface TeamRuntimeStreamHost {
	readonly runtime: () => RuntimeHost;
	readonly getSession: (teamSessionId: string) => TeamSessionDocument | undefined;
	readonly observe: (session: TeamSessionDocument) => TeamObservationPublisher | undefined;
}

/** Owns Team subscribers, active member turns, and member Runtime stream subscriptions. */
export class TeamSessionEventHub {
	private readonly runtimeSubscriptions = new Map<
		string,
		{ readonly teamSessionId: string; readonly unsubscribe: () => void }
	>();
	private readonly subscribers = new Map<string, Set<(event: DesktopTeamSessionStreamEvent) => void>>();
	private readonly activeMemberTurns = new Map<string, ActiveTeamMemberTurn>();

	constructor(private readonly host: TeamRuntimeStreamHost) {}

	addSubscriber(sessionId: string, handler: (event: DesktopTeamSessionStreamEvent) => void): () => void {
		const listeners = this.subscribers.get(sessionId) ?? new Set();
		listeners.add(handler);
		this.subscribers.set(sessionId, listeners);
		return () => {
			listeners.delete(handler);
			if (listeners.size === 0) {
				this.subscribers.delete(sessionId);
				this.detachIdle(sessionId);
			}
		};
	}

	hasSubscribers(sessionId: string): boolean {
		return this.subscribers.has(sessionId);
	}

	publish(event: DesktopTeamSessionStreamEvent): void {
		const teamSessionId =
			event.type === "session-snapshot" || event.type === "session-updated"
				? event.teamSessionId
				: event.conversationId;
		for (const listener of this.subscribers.get(teamSessionId) ?? []) listener(event);
	}

	beginTurn(runtimeSessionId: string, active: ActiveTeamMemberTurn): void {
		this.activeMemberTurns.set(runtimeSessionId, active);
	}

	endTurn(runtimeSessionId: string): void {
		const active = this.activeMemberTurns.get(runtimeSessionId);
		this.activeMemberTurns.delete(runtimeSessionId);
		if (active) this.detachIdle(active.teamSessionId);
	}

	isTurnActive(runtimeSessionId: string): boolean {
		return this.activeMemberTurns.has(runtimeSessionId);
	}

	discard(active: ActiveTeamMemberTurn, reason: "completed" | "waiting" | "failed" | "aborted", error?: string): void {
		active.seq += 1;
		this.publish({
			type: "conversation.agent-message-discard",
			conversationId: active.teamSessionId,
			messageId: active.messageId,
			turnId: active.requestId,
			author: active.author,
			sequence: active.seq,
			timestamp: Date.now(),
			reason,
			...(error ? { error } : {}),
		});
	}

	detach(runtimeSessionId: string): void {
		const subscription = this.runtimeSubscriptions.get(runtimeSessionId);
		if (!subscription) return;
		subscription.unsubscribe();
		this.runtimeSubscriptions.delete(runtimeSessionId);
	}

	attach(session: TeamSessionDocument): void {
		for (const runtimeState of Object.values(session.memberRuntime)) {
			if (this.runtimeSubscriptions.has(runtimeState.sessionId)) continue;
			const runtime = this.host.runtime();
			const unsubscribeEvents = runtime.subscribe(runtimeState.sessionId, (event) => {
				const active = this.activeMemberTurns.get(runtimeState.sessionId);
				if (!active) {
					if (
						event.type === "usage.update" ||
						event.type === "compaction.start" ||
						event.type === "compaction.end"
					) {
						this.publishTeamContextUsage(session, runtimeState.sessionId, event);
					}
					return;
				}
				if (event.type === "usage.update" || event.type === "compaction.start" || event.type === "compaction.end") {
					this.publishTeamContextUsage(session, runtimeState.sessionId, event);
				}
				if (event.channel === "assistant") {
					active.rawAssistantStream = true;
					const projected = projectPublicAssistantEvent(event);
					if (projected) {
						if (projected.type === "text_delta") active.text += projected.delta;
						if ("partial" in projected) active.latestPublicPartial = projected.partial;
						this.publishMemberMessageEvent(active, projected, event.timestamp);
					}
					return;
				}
				if (event.type === "message.delta" && event.delta && !active.rawAssistantStream) {
					active.seq += 1;
					active.text += event.delta;
					const partial = compatibilityPublicAssistantMessage(active.text, event.timestamp);
					active.latestPublicPartial = partial;
					this.publish({
						type: "conversation.agent-message-event",
						conversationId: active.teamSessionId,
						messageId: active.messageId,
						turnId: active.requestId,
						author: active.author,
						sequence: active.seq,
						timestamp: event.timestamp,
						event: { type: "text_delta", contentIndex: 0, delta: event.delta, partial },
					});
				}
			});
			let unsubscribeExecution = () => {};
			try {
				if (typeof runtime.subscribeExecutionObservations === "function") {
					unsubscribeExecution = runtime.subscribeExecutionObservations(runtimeState.sessionId, (observation) => {
						const active = this.activeMemberTurns.get(runtimeState.sessionId);
						if (!active) return;
						const currentSession = this.host.getSession(active.teamSessionId) ?? session;
						const correlated = correlateTeamMemberToolExecution(
							{
								teamId: currentSession.teamId,
								coordinationConversationId: currentSession.coordinationRuntime?.sessionId ?? currentSession.id,
								participantId: active.memberId,
								workItemId: active.workItemId,
								attemptId: active.attemptId,
								requestTurnId: active.requestId,
								sourceTurnId: active.turnId,
								...(active.deliveryId ? { deliveryId: active.deliveryId } : {}),
								runtimeSessionId: runtimeState.sessionId,
							},
							observation,
						);
						if (correlated) this.host.observe(currentSession)?.publishMemberToolExecution(correlated);
						this.publishMemberToolExecutionEvent(active, observation);
					});
				}
			} catch (error) {
				unsubscribeEvents();
				throw error;
			}
			let unsubscribed = false;
			const unsubscribe = () => {
				if (unsubscribed) return;
				unsubscribed = true;
				unsubscribeEvents();
				unsubscribeExecution();
			};
			this.runtimeSubscriptions.set(runtimeState.sessionId, { teamSessionId: session.id, unsubscribe });
		}
	}

	detachIdle(teamSessionId: string): void {
		const hasActiveTurn = [...this.activeMemberTurns.values()].some((turn) => turn.teamSessionId === teamSessionId);
		if (hasActiveTurn || this.hasSubscribers(teamSessionId)) return;
		for (const [runtimeSessionId, subscription] of this.runtimeSubscriptions) {
			if (subscription.teamSessionId !== teamSessionId) continue;
			subscription.unsubscribe();
			this.runtimeSubscriptions.delete(runtimeSessionId);
		}
	}

	activeMessageEvents(teamSessionId: string): ConversationMessageStreamEvent[] {
		return [...this.activeMemberTurns.values()]
			.filter((turn) => turn.teamSessionId === teamSessionId)
			.flatMap((turn) => {
				const partial = turn.latestPublicPartial ?? compatibilityPublicAssistantMessage(turn.text, turn.startedAt);
				const visibleParts = partial.content
					.filter(isPublicAssistantPart)
					.filter((part) => part.type !== "text" || part.text.length > 0);
				const sequenceBase = Math.max(0, turn.seq - visibleParts.length);
				return visibleParts.map(
					(part, contentIndex): ConversationMessageStreamEvent => ({
						type: "conversation.agent-message-event",
						conversationId: turn.teamSessionId,
						messageId: turn.messageId,
						turnId: turn.requestId,
						author: turn.author,
						sequence: sequenceBase + contentIndex + 1,
						timestamp: turn.startedAt,
						event:
							part.type === "text"
								? { type: "text_delta", contentIndex, delta: part.text, partial }
								: { type: "toolcall_end", contentIndex, toolCall: part, partial },
					}),
				);
			});
	}

	private publishMemberMessageEvent(
		active: ActiveTeamMemberTurn,
		event: AssistantMessageEvent,
		timestamp: number,
	): void {
		active.seq += 1;
		this.publish({
			type: "conversation.agent-message-event",
			conversationId: active.teamSessionId,
			messageId: active.messageId,
			turnId: active.requestId,
			author: active.author,
			sequence: active.seq,
			timestamp,
			event,
		});
	}

	private publishTeamContextUsage(session: TeamSessionDocument, runtimeSessionId: string, event: SessionEvent): void {
		const memberId = Object.entries(session.memberRuntime).find(
			([, runtime]) => runtime.sessionId === runtimeSessionId,
		)?.[0];
		if (!memberId) return;
		const state = this.host.runtime().getState(runtimeSessionId);
		const contextUsage = {
			percent: event.type === "usage.update" ? event.contextPercent : state.contextPercent,
			...(event.type === "usage.update" && event.contextTokens !== undefined
				? { contextTokens: event.contextTokens }
				: state.contextTokens === undefined
					? {}
					: { contextTokens: state.contextTokens }),
			contextWindow: event.type === "usage.update" ? event.contextWindow : state.contextWindow,
			...(event.type === "usage.update" && event.contextComposition
				? { composition: event.contextComposition }
				: {}),
		};
		this.publish({
			type: "desktop.team-context-usage",
			conversationId: session.id,
			memberId,
			runtimeSessionId,
			contextUsage,
			...(event.type === "compaction.start"
				? { isCompacting: true }
				: event.type === "compaction.end"
					? { isCompacting: false }
					: {}),
		} satisfies DesktopTeamContextUsageEvent);
	}

	private publishMemberToolExecutionEvent(
		active: ActiveTeamMemberTurn,
		observation: RuntimeSessionExecutionObservation,
	): void {
		const event = observation.event;
		let projected: DesktopTeamToolExecutionEvent["event"] | undefined;
		switch (event.type) {
			case "tool.execution.start":
				projected = {
					type: "start",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
					startedAt: event.startedAt,
				};
				break;
			case "tool.execution.update":
				projected = {
					type: "update",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					partialResult: event.partialResult,
				};
				break;
			case "tool.execution.phase":
				projected = {
					type: "phase",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					label: event.label,
					atMs: event.atMs,
				};
				break;
			case "tool.execution.end":
				projected = {
					type: "end",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					result: event.result,
					isError: event.isError,
					startedAt: event.startedAt,
					durationMs: event.durationMs,
					phases: [...event.phases],
				};
				break;
			default:
				return;
		}
		active.seq += 1;
		this.publish({
			type: "desktop.team-tool-execution",
			conversationId: active.teamSessionId,
			messageId: active.messageId,
			turnId: active.requestId,
			author: active.author,
			sequence: active.seq,
			timestamp: observation.timestamp,
			event: projected,
		});
	}
}

function projectPublicAssistantEvent(event: AssistantMessageEvent): AssistantMessageEvent | undefined {
	if (event.type === "start") return { ...event, partial: publicAssistantMessage(event.partial) };
	if (
		event.type !== "text_start" &&
		event.type !== "text_delta" &&
		event.type !== "text_end" &&
		event.type !== "toolcall_start" &&
		event.type !== "toolcall_delta" &&
		event.type !== "toolcall_end"
	)
		return undefined;
	const partial = publicAssistantMessage(event.partial);
	const contentIndex = event.partial.content.slice(0, event.contentIndex).filter(isPublicAssistantPart).length;
	return { ...event, contentIndex, partial };
}

function compatibilityPublicAssistantMessage(text: string, timestamp: number): AssistantMessage {
	return {
		...createAssistantMessage(
			{ api: "openai-responses", provider: "agent-team-public-stream", model: "compatibility" },
			{ timestamp },
		),
		content: text.length > 0 ? [{ type: "text", text }] : [],
	};
}

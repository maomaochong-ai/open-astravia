import type { SessionEvent } from "@vetta/runtime-core";
import type { PetActionId } from "../../shared/pet-actions.js";
import type { PetActivityState, PetBubbleNotice, PetCommand } from "../../shared/pet-ipc.js";
import { createPetBubbleCommand } from "./pet-bubble-command.js";
import {
	createPetStatePresentation,
	mapSessionEventToPetPresentation,
	type PetPresentation,
} from "./session-event-action-policy.js";

export const PET_PRESENTATION_MIN_HOLD_MS = 3_000;

interface SessionPresentationRecord {
	base: PetPresentation & { state: PetActivityState; actionId: PetActionId };
	waiting: Map<string, PetBubbleNotice>;
	failed: boolean;
	aborted: boolean;
	hasFinalBody: boolean;
	updatedAt: number;
	terminalTimer?: ReturnType<typeof setTimeout>;
}

interface EffectivePresentation {
	state: PetActivityState;
	actionId: PetActionId;
	sessionId?: string;
}

interface PetSessionPresentationControllerOptions {
	send(command: PetCommand): void;
	now?: () => number;
}

const STATE_PRIORITY = {
	idle: 0,
	paused: 10,
	success: 20,
	thinking: 30,
	working: 40,
	error: 50,
	waiting_input: 60,
} satisfies Record<PetActivityState, number>;

function samePresentation(left: EffectivePresentation | undefined, right: EffectivePresentation): boolean {
	return left?.state === right.state && left.actionId === right.actionId && left.sessionId === right.sessionId;
}

function assistantStopReason(event: SessionEvent): string | undefined {
	if (event.type === "message.final") {
		const stopReason = (event.message as unknown as { stopReason?: unknown }).stopReason;
		return typeof stopReason === "string" ? stopReason : undefined;
	}
	if (event.channel === "assistant" && event.type === "done") return event.message.stopReason;
	if (event.channel === "assistant" && event.type === "error") return "error";
	return undefined;
}

export class PetSessionPresentationController {
	private readonly records = new Map<string, SessionPresentationRecord>();
	private readonly send: (command: PetCommand) => void;
	private readonly now: () => number;
	private current?: EffectivePresentation;
	private pending?: EffectivePresentation;
	private holdUntil = 0;
	private transitionTimer?: ReturnType<typeof setTimeout>;
	private sequence = 0;

	constructor(options: PetSessionPresentationControllerOptions) {
		this.send = options.send;
		this.now = options.now ?? Date.now;
	}

	handleSessionEvent(event: SessionEvent): void {
		const record = this.getRecord(event.sessionId);
		if (event.type === "session.lifecycle" && event.phase === "agent_start") {
			this.clearTerminalTimer(record);
			record.failed = false;
			record.aborted = false;
			record.hasFinalBody = false;
		}

		const stopReason = assistantStopReason(event);
		if ((event.channel !== "assistant" && event.type === "error") || stopReason === "error") record.failed = true;
		if ((event.type === "session.lifecycle" && event.phase === "aborted") || stopReason === "aborted") {
			record.aborted = true;
		}

		let presentation = mapSessionEventToPetPresentation(event);
		if (event.type === "session.lifecycle" && event.phase === "agent_end") {
			presentation = record.failed
				? createPetStatePresentation("error")
				: record.aborted
					? createPetStatePresentation("paused", presentation?.bubble)
					: createPetStatePresentation("success", record.hasFinalBody ? undefined : presentation?.bubble);
		}

		if (presentation?.bubble) {
			const command = createPetBubbleCommand(presentation.bubble, event.sessionId);
			if (command) this.send(command);
			if (presentation.bubble.body && this.isAssistantFinal(event)) record.hasFinalBody = true;
		}

		if (presentation?.state && presentation.actionId) {
			this.setBase(record, presentation.state, presentation.actionId);
		}
	}

	beginWaiting(sessionId: string, requestKey: string, messageKey: string): void {
		const record = this.getRecord(sessionId);
		const notice: PetBubbleNotice = {
			kind: "warning",
			messageKey,
			persistent: true,
			ttlMs: PET_PRESENTATION_MIN_HOLD_MS,
			dedupeKey: "session-status",
		};
		record.waiting.set(requestKey, notice);
		record.updatedAt = ++this.sequence;
		const command = createPetBubbleCommand(notice, sessionId);
		if (command) this.send(command);
		this.recompute();
	}

	endWaiting(sessionId: string, requestKey: string): void {
		const record = this.records.get(sessionId);
		if (!record?.waiting.delete(requestKey)) return;
		record.updatedAt = ++this.sequence;
		if (record.waiting.size === 0 && (record.base.state === "thinking" || record.base.state === "working")) {
			const command = createPetBubbleCommand(
				{
					kind: "status",
					messageKey: "notice.lifecycle.resumed",
					persistent: true,
					ttlMs: PET_PRESENTATION_MIN_HOLD_MS,
					dedupeKey: "session-status",
				},
				sessionId,
			);
			if (command) this.send(command);
		}
		this.recompute();
	}

	forgetSession(sessionId: string): void {
		const record = this.records.get(sessionId);
		if (!record) return;
		this.clearTerminalTimer(record);
		this.records.delete(sessionId);
		this.recompute();
	}

	dispose(): void {
		if (this.transitionTimer) clearTimeout(this.transitionTimer);
		this.transitionTimer = undefined;
		for (const record of this.records.values()) this.clearTerminalTimer(record);
		this.records.clear();
		this.pending = undefined;
	}

	private getRecord(sessionId: string): SessionPresentationRecord {
		const existing = this.records.get(sessionId);
		if (existing) return existing;
		const created: SessionPresentationRecord = {
			base: createPetStatePresentation("idle"),
			waiting: new Map(),
			failed: false,
			aborted: false,
			hasFinalBody: false,
			updatedAt: ++this.sequence,
		};
		this.records.set(sessionId, created);
		return created;
	}

	private setBase(record: SessionPresentationRecord, state: PetActivityState, actionId: PetActionId): void {
		if (record.base.state !== state) this.clearTerminalTimer(record);
		record.base = { state, actionId };
		record.updatedAt = ++this.sequence;
		this.recompute();
	}

	private recompute(): void {
		const selected = this.selectPresentation();
		this.requestTransition(selected ?? createPetStatePresentation("idle"));
	}

	private selectPresentation(): EffectivePresentation | undefined {
		let selected: EffectivePresentation | undefined;
		let selectedPriority = -1;
		let selectedUpdatedAt = -1;
		for (const [sessionId, record] of this.records) {
			const waiting = record.waiting.size > 0;
			const presentation = waiting ? createPetStatePresentation("waiting_input") : record.base;
			const priority = STATE_PRIORITY[presentation.state];
			if (priority < selectedPriority || (priority === selectedPriority && record.updatedAt <= selectedUpdatedAt)) {
				continue;
			}
			selected = { state: presentation.state, actionId: presentation.actionId, sessionId };
			selectedPriority = priority;
			selectedUpdatedAt = record.updatedAt;
		}
		return selected;
	}

	private requestTransition(next: EffectivePresentation): void {
		if (samePresentation(this.current, next)) {
			this.pending = undefined;
			if (this.transitionTimer) clearTimeout(this.transitionTimer);
			this.transitionTimer = undefined;
			return;
		}
		const now = this.now();
		if (!this.current || now >= this.holdUntil) {
			this.applyTransition(next);
			return;
		}
		this.pending = next;
		if (this.transitionTimer) return;
		this.transitionTimer = setTimeout(
			() => {
				this.transitionTimer = undefined;
				const pending = this.pending;
				this.pending = undefined;
				if (pending) this.applyTransition(pending);
			},
			Math.max(0, this.holdUntil - now),
		);
	}

	private applyTransition(next: EffectivePresentation): void {
		if (this.transitionTimer) clearTimeout(this.transitionTimer);
		this.transitionTimer = undefined;
		this.pending = undefined;
		this.current = next;
		this.holdUntil = this.now() + PET_PRESENTATION_MIN_HOLD_MS;
		this.send({
			type: "set-state",
			state: next.state,
			actionId: next.actionId,
			...(next.sessionId ? { sessionId: next.sessionId } : {}),
		});
		if (next.sessionId && (next.state === "success" || next.state === "paused")) {
			const record = this.records.get(next.sessionId);
			if (record?.base.state === next.state && !record.terminalTimer) {
				record.terminalTimer = setTimeout(() => {
					record.terminalTimer = undefined;
					if (record.base.state !== next.state) return;
					record.base = createPetStatePresentation("idle");
					record.updatedAt = ++this.sequence;
					this.recompute();
				}, PET_PRESENTATION_MIN_HOLD_MS);
			}
		}
	}

	private clearTerminalTimer(record: SessionPresentationRecord): void {
		if (record.terminalTimer) clearTimeout(record.terminalTimer);
		record.terminalTimer = undefined;
	}

	private isAssistantFinal(event: SessionEvent): boolean {
		return (
			event.type === "message.final" ||
			(event.channel === "assistant" && (event.type === "done" || event.type === "error"))
		);
	}
}

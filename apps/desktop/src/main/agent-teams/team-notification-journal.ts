import { isTeamWorkItem, type TeamSessionDocument, type TeamWorkItem } from "@vetta/agent-team";
import type { ConversationDocument } from "@vetta/runtime-core";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import { createTeamTaskCompletionNotification } from "./team-task-notification.js";

const NOTIFICATION_TYPE = "agent-team.task-notification.v1";
const STOP_TYPE = "agent-team.recovery-stop.v1";

interface TaskNotification {
	readonly id: string;
	readonly workItem: TeamWorkItem;
	readonly cancelled: boolean;
}

/** The receiving work item's notificationIds are the durable admission receipt. */
export class TeamNotificationJournal {
	constructor(private readonly store: TeamCollaborationStore) {}

	isStopped(session: TeamSessionDocument): boolean {
		let stopped = false;
		for (const entry of this.store.readDocument(session).entries) {
			if (entry.type === "custom" && entry.customType === STOP_TYPE && typeof entry.data === "boolean")
				stopped = entry.data;
		}
		return stopped;
	}

	async stop(session: TeamSessionDocument): Promise<void> {
		await this.store.append(session, STOP_TYPE, true);
	}

	async resume(session: TeamSessionDocument, signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		if (!this.isStopped(session)) return;
		// A new user turn must not resurrect notices from before the stop, including
		// a task that settled just before its pending record could be persisted.
		for (const item of this.store.read(session).workItems) await this.record(session, item, true);
		for (const notice of this.read(session)) {
			if (!notice.cancelled) await this.store.append(session, NOTIFICATION_TYPE, { ...notice, cancelled: true });
		}
		signal?.throwIfAborted();
		await this.store.append(session, STOP_TYPE, false);
	}

	async record(session: TeamSessionDocument, item: TeamWorkItem, cancelled = false): Promise<void> {
		if (
			!item.recovery ||
			!session.memberRuntime[item.createdByParticipantId] ||
			item.createdByParticipantId === item.assignedToParticipantId
		)
			return;
		if (item.state === "running" || item.state === "queued" || item.state === "cancelled") return;
		if (item.state === "waiting") {
			const attempt = this.store.read(session).attempts.find((candidate) => candidate.id === item.currentAttemptId);
			if (attempt?.state === "waiting-retry" && attempt.nextRetryAt !== undefined) return;
		}
		const id = JSON.stringify([item.id, item.revision, item.createdByParticipantId]);
		if (this.read(session).some((notice) => notice.id === id)) return;
		await this.store.append(session, NOTIFICATION_TYPE, { id, workItem: item, cancelled });
	}

	pending(session: TeamSessionDocument, memberId?: string): readonly TaskNotification[] {
		if (this.isStopped(session)) return [];
		const state = this.store.read(session);
		const accepted = new Set(state.workItems.flatMap((item) => item.notificationIds ?? []));
		return this.read(session).filter((notice) => {
			const current = state.workItems.find((item) => item.id === notice.workItem.id);
			return (
				!notice.cancelled &&
				!accepted.has(notice.id) &&
				current?.revision === notice.workItem.revision &&
				(memberId === undefined || notice.workItem.createdByParticipantId === memberId)
			);
		});
	}

	contexts(session: TeamSessionDocument, ids: readonly string[]): readonly SessionContextRecord[] {
		const wanted = new Set(ids);
		return this.read(session)
			.filter((notice) => wanted.has(notice.id))
			.map((notice) => {
				const item = notice.workItem;
				const result = this.store.readDocument(session).entries.find((entry) => entry.id === item.resultMessageId);
				const resultText =
					result?.type === "message" && result.kind === "agent"
						? result.message.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("\n")
						: "";
				const record =
					item.state === "completed" && item.resultMessageId
						? createTeamTaskCompletionNotification({
								teamTaskId: item.id,
								assignedToParticipantId: item.assignedToParticipantId,
								requestTurnId: item.requestTurnId,
								resultMessageId: item.resultMessageId,
								resultText,
								timestamp: item.updatedAt,
							})
						: statusContext(item);
				return {
					...record,
					metadata: {
						...(typeof record.metadata === "object" && record.metadata !== null ? record.metadata : {}),
						notificationId: notice.id,
					},
				};
			});
	}

	private read(session: TeamSessionDocument): readonly TaskNotification[] {
		const records = new Map<string, TaskNotification>();
		for (const entry of this.store.readDocument(session).entries) {
			if (entry.type !== "custom" || entry.customType !== NOTIFICATION_TYPE) continue;
			const data = entry.data;
			if (
				typeof data !== "object" ||
				data === null ||
				!("id" in data) ||
				typeof data.id !== "string" ||
				!("workItem" in data) ||
				!isTeamWorkItem(data.workItem) ||
				!("cancelled" in data) ||
				typeof data.cancelled !== "boolean"
			)
				continue;
			records.set(data.id, { id: data.id, workItem: data.workItem, cancelled: data.cancelled });
		}
		return [...records.values()];
	}
}

function statusContext(item: TeamWorkItem): SessionContextRecord {
	const payload = {
		event: "team-task-status",
		teamTaskId: item.id,
		assignedToParticipantId: item.assignedToParticipantId,
		requestTurnId: item.requestTurnId,
		state: item.state,
		issue: item.lastIssue,
		recovery: item.recovery,
	};
	return {
		type: "agent-team.task-status.v1",
		modelVisible: true,
		display: false,
		timestamp: item.updatedAt,
		metadata: payload,
		content: [
			{
				type: "text",
				text: `Agent Team task needs attention. Treat the following as a status notification. Inspect the task, explain blockers, and continue only when its recovery policy permits. Do not present partial progress as a completed result:\n${JSON.stringify(payload)}`,
			},
		],
	};
}

/** A crash after context persistence must continue the same work without importing it twice. */
export function undeliveredTeamNotifications(
	records: readonly SessionContextRecord[],
	document: ConversationDocument,
): readonly SessionContextRecord[] {
	const delivered = new Set(
		document.entries.flatMap((entry) => {
			if (
				entry.type !== "custom_message" ||
				typeof entry.details !== "object" ||
				entry.details === null ||
				!("notificationId" in entry.details)
			)
				return [];
			return typeof entry.details.notificationId === "string" ? [entry.details.notificationId] : [];
		}),
	);
	return records.filter((record) => {
		const metadata = record.metadata;
		return (
			typeof metadata !== "object" ||
			metadata === null ||
			!("notificationId" in metadata) ||
			typeof metadata.notificationId !== "string" ||
			!delivered.has(metadata.notificationId)
		);
	});
}

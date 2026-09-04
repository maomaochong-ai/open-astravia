import type { TeamSessionDocument, TeamSessionStateRecord } from "@vetta/agent-team";
import type { RuntimeHost } from "@vetta/runtime-core";
import type { ConversationOwnershipCatalogPort } from "../conversations/conversation-ownership-catalog.js";
import { TeamOperationQueue } from "./team-operation-queue.js";
import { registerAgentTeamSessionOwnership } from "./team-ownership-backfill.js";

export interface TeamSessionStateRepositoryOptions {
	readonly runtime: () => RuntimeHost;
	readonly ownershipCatalog?: ConversationOwnershipCatalogPort;
}

/** Sole owner of loaded Team Session state, coordination paths, persistence, and per-session transactions. */
export class TeamSessionStateRepository {
	private readonly sessions = new Map<string, TeamSessionDocument>();
	private readonly coordinationPaths = new Map<string, string>();
	private readonly transactions = new TeamOperationQueue();

	constructor(private readonly options: TeamSessionStateRepositoryOptions) {}

	get(sessionId: string): TeamSessionDocument | undefined {
		return this.sessions.get(sessionId);
	}

	set(session: TeamSessionDocument): void {
		this.sessions.set(session.id, session);
	}

	values(): readonly TeamSessionDocument[] {
		return [...this.sessions.values()];
	}

	rememberCoordinationPath(sessionId: string, sessionPath: string): void {
		this.coordinationPaths.set(sessionId, sessionPath);
	}

	coordinationPath(sessionId: string): string | undefined {
		return this.coordinationPaths.get(sessionId);
	}

	async persist(session: TeamSessionDocument): Promise<void> {
		const coordination = session.coordinationRuntime;
		if (!coordination) throw new Error("Team coordination conversation is unavailable");
		const record: TeamSessionStateRecord = { customType: "agent-team.session-state.v1", session };
		const document = this.options.runtime().readSessionDocument(coordination.sessionId);
		let latest: (typeof document.entries)[number] | undefined;
		for (let index = document.entries.length - 1; index >= 0; index -= 1) {
			const entry = document.entries[index];
			if (entry?.type === "custom" && entry.customType === record.customType) {
				latest = entry;
				break;
			}
		}
		if (
			latest?.type !== "custom" ||
			!isTeamSessionStateRecord(latest.data) ||
			JSON.stringify(latest.data.session) !== JSON.stringify(session)
		) {
			await this.options.runtime().appendSessionMetadataEntry(coordination.sessionId, record.customType, record);
		}
		await this.registerOwnership(session);
		this.set(session);
	}

	registerOwnership(session: TeamSessionDocument): Promise<void> {
		if (!this.options.ownershipCatalog) return Promise.resolve();
		return registerAgentTeamSessionOwnership(session, this.options.ownershipCatalog);
	}

	coordinate<T>(
		sessionId: string,
		load: () => Promise<TeamSessionDocument>,
		operation: (session: TeamSessionDocument) => Promise<T>,
	): Promise<T> {
		return this.transactions.run(sessionId, async () => operation(await load()));
	}

	coordinateLoaded<T>(sessionId: string, operation: (session: TeamSessionDocument) => Promise<T>): Promise<T> {
		return this.transactions.run(sessionId, async () => {
			const session = this.get(sessionId);
			if (!session) throw new Error(`Team session is not loaded: ${sessionId}`);
			return operation(session);
		});
	}
}

function isTeamSessionStateRecord(value: unknown): value is TeamSessionStateRecord {
	return (
		typeof value === "object" &&
		value !== null &&
		"customType" in value &&
		value.customType === "agent-team.session-state.v1" &&
		"session" in value
	);
}

import type { TeamSessionDocument } from "@vetta/agent-team";
import type { SessionConfig } from "@vetta/runtime-core";

export interface TeamMemberRuntimeReconfigurationHost {
	getSessionPath(sessionId: string): string | undefined;
	createSession(config: SessionConfig): Promise<{ sessionId: string }>;
	disposeSession(sessionId: string): Promise<void>;
}

export interface TeamMemberRuntimeReconfigurationLogger {
	info(message: string, context: Record<string, unknown>): void;
	error(message: string, context: Record<string, unknown>): void;
}

/**
 * Reopens one persisted member conversation with the latest profile configuration.
 * The JSONL history remains the stable identity; only the live runtime binding changes.
 */
export async function reconfigureTeamMemberRuntime(input: {
	readonly session: TeamSessionDocument;
	readonly memberId: string;
	readonly agentProfileId: string;
	readonly agentProfileRevision: number;
	readonly runtime: TeamMemberRuntimeReconfigurationHost;
	readonly resolveConfig: (sessionPath: string) => Promise<SessionConfig>;
	readonly persist: (session: TeamSessionDocument) => Promise<void>;
	readonly now?: () => number;
	readonly logger: TeamMemberRuntimeReconfigurationLogger;
}): Promise<TeamSessionDocument> {
	const current = input.session.memberRuntime[input.memberId];
	if (!current) throw new Error(`Team member runtime not found: ${input.memberId}`);
	if (current.agentProfileId === input.agentProfileId && current.agentProfileRevision === input.agentProfileRevision) {
		return input.session;
	}

	const activePath = input.runtime.getSessionPath(current.sessionId);
	if (activePath && activePath !== current.sessionPath) {
		throw new Error(`Runtime session id is already bound to another path: ${current.sessionId}`);
	}

	const config = await input.resolveConfig(current.sessionPath);
	let createdSessionId: string | undefined;
	try {
		if (activePath) await input.runtime.disposeSession(current.sessionId);
		const created = await input.runtime.createSession(config);
		createdSessionId = created.sessionId;
		const sessionPath = input.runtime.getSessionPath(created.sessionId);
		if (sessionPath !== current.sessionPath) {
			throw new Error(`Reconfigured team member session path changed: ${input.memberId}`);
		}

		const next: TeamSessionDocument = {
			...input.session,
			revision: input.session.revision + 1,
			updatedAt: (input.now ?? Date.now)(),
			memberRuntime: {
				...input.session.memberRuntime,
				[input.memberId]: {
					...current,
					sessionId: created.sessionId,
					sessionPath,
					agentProfileId: input.agentProfileId,
					agentProfileRevision: input.agentProfileRevision,
				},
			},
		};
		await input.persist(next);
		input.logger.info("team member runtime reconfigured", {
			teamSessionId: input.session.id,
			memberId: input.memberId,
			agentProfileId: input.agentProfileId,
			agentProfileRevision: input.agentProfileRevision,
		});
		return next;
	} catch (error) {
		if (createdSessionId) await input.runtime.disposeSession(createdSessionId).catch(() => undefined);
		input.logger.error("team member runtime reconfiguration failed", {
			teamSessionId: input.session.id,
			memberId: input.memberId,
			agentProfileId: input.agentProfileId,
			agentProfileRevision: input.agentProfileRevision,
			error: errorMessage(error),
		});
		throw error;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

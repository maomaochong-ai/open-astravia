import type { TeamSessionDocument } from "@vetta/agent-team";
import type { SessionConfig } from "@vetta/runtime-core";

export interface TeamRuntimeResumeHost {
	getSessionPath(sessionId: string): string | undefined;
	createSession(config: SessionConfig): Promise<{ sessionId: string }>;
	disposeSession(sessionId: string): Promise<void>;
}

export interface TeamRuntimeRestoreLogger {
	info(message: string, context: Record<string, unknown>): void;
	error(message: string, context: Record<string, unknown>): void;
}

export interface TeamRuntimeResumeConfig<TRuntimeTool> {
	readonly memberId: string;
	readonly cwd: string;
	readonly sessionPath: string;
	readonly runtimeTools: readonly TRuntimeTool[];
}

export interface TeamRuntimeResolvedConfig {
	readonly config: SessionConfig;
	readonly agentProfileId: string;
	readonly agentProfileRevision: number;
}

export async function restoreTeamMemberRuntimes<TRuntimeTool>(input: {
	readonly session: TeamSessionDocument;
	readonly runtime: TeamRuntimeResumeHost;
	readonly createRuntimeTools: () => readonly TRuntimeTool[];
	readonly resolveConfig: (config: TeamRuntimeResumeConfig<TRuntimeTool>) => Promise<TeamRuntimeResolvedConfig>;
	readonly persist: (session: TeamSessionDocument) => Promise<void>;
	readonly now?: () => number;
	readonly logger: TeamRuntimeRestoreLogger;
}): Promise<TeamSessionDocument> {
	const restoredRuntime = { ...input.session.memberRuntime };
	const createdSessionIds: string[] = [];
	let changed = false;
	try {
		const results = await Promise.allSettled(
			Object.entries(input.session.memberRuntime).map(async ([memberId, runtimeState]) => {
				const activePath = input.runtime.getSessionPath(runtimeState.sessionId);
				if (activePath) {
					if (activePath !== runtimeState.sessionPath) {
						throw new Error(`Runtime session id is already bound to another path: ${runtimeState.sessionId}`);
					}
					return { memberId, runtimeState, changed: false };
				}

				const resolved = await input.resolveConfig({
					memberId,
					cwd: input.session.cwd,
					sessionPath: runtimeState.sessionPath,
					runtimeTools: input.createRuntimeTools(),
				});
				const created = await input.runtime.createSession(resolved.config);
				createdSessionIds.push(created.sessionId);
				const sessionPath = input.runtime.getSessionPath(created.sessionId);
				if (sessionPath !== runtimeState.sessionPath) {
					throw new Error(`Restored team member session path changed: ${memberId}`);
				}
				input.logger.info("team member runtime restored", {
					teamSessionId: input.session.id,
					memberId,
					runtimeSessionId: created.sessionId,
				});
				return {
					memberId,
					runtimeState: {
						...runtimeState,
						sessionId: created.sessionId,
						sessionPath,
						agentProfileId: resolved.agentProfileId,
						agentProfileRevision: resolved.agentProfileRevision,
					},
					changed:
						created.sessionId !== runtimeState.sessionId ||
						runtimeState.agentProfileId !== resolved.agentProfileId ||
						runtimeState.agentProfileRevision !== resolved.agentProfileRevision,
				};
			}),
		);
		const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
		if (rejected) throw rejected.reason;
		for (const result of results) {
			if (result.status !== "fulfilled") continue;
			restoredRuntime[result.value.memberId] = result.value.runtimeState;
			changed ||= result.value.changed;
		}
	} catch (error) {
		await Promise.allSettled(createdSessionIds.map((sessionId) => input.runtime.disposeSession(sessionId)));
		input.logger.error("team session runtime restore rolled back", {
			teamSessionId: input.session.id,
			restoredMemberCount: createdSessionIds.length,
			error: errorMessage(error),
		});
		throw error;
	}

	if (!changed) return input.session;
	const restored: TeamSessionDocument = {
		...input.session,
		revision: input.session.revision + 1,
		updatedAt: (input.now ?? Date.now)(),
		memberRuntime: restoredRuntime,
	};
	await input.persist(restored);
	return restored;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

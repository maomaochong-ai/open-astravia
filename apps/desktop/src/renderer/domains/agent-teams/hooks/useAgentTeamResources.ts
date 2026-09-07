import type { AgentBlueprint, AgentTeamDocument } from "@vetta/agent-team";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import type { AgentCapabilityOption } from "../lib/capability-options";
import { loadAgentTeamConfigurationResources } from "../services/load-agent-team-resources";

/**
 * Agent 与 Team 共用同一份 `AgentTeamDocument`，所以文档、蓝图和能力目录集中在
 * 这里加载，再由各职责 model 消费，避免两套状态各自请求后互相覆盖。
 */
export interface AgentTeamResources {
	readonly document?: AgentTeamDocument;
	readonly setDocument: Dispatch<SetStateAction<AgentTeamDocument | undefined>>;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly loading: boolean;
	readonly error?: string;
	readonly setError: (error: string | undefined) => void;
	readonly reload: () => Promise<void>;
}

export function useAgentTeamResources(): AgentTeamResources {
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [blueprints, setBlueprints] = useState<readonly AgentBlueprint[]>([]);
	const [capabilities, setCapabilities] = useState<readonly AgentCapabilityOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		void loadAgentTeamConfigurationResources()
			.then((resources) => {
				if (cancelled) return;
				setDocument(resources.document);
				setBlueprints(resources.blueprints);
				setCapabilities(resources.capabilities);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(agentTeamErrorMessage(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const reload = useCallback(async () => {
		try {
			setDocument(await window.vetta.agentTeams.list());
			setError(undefined);
		} catch (cause) {
			setError(agentTeamErrorMessage(cause));
		}
	}, []);

	return { document, setDocument, blueprints, capabilities, loading, error, setError, reload };
}

export function agentTeamErrorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

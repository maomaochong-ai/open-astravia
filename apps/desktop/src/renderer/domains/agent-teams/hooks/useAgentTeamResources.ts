import { useLocalizedAgentTeamDocument } from "@shared/agent-teams/agent-team-localization";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import type { AgentBlueprint, AgentTeamDocument } from "@vetta/agent-team";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import type { BlueprintDisplayPlugin } from "../lib/blueprint-display";
import type { AgentCapabilityOption } from "../lib/capability-options";
import { loadAgentTeamConfigurationResources } from "../services/load-agent-team-resources";

/**
 * Agent 与 Team 共用同一份 `AgentTeamDocument`，所以文档、蓝图和能力目录集中在
 * 这里加载，再由各职责 model 消费，避免两套状态各自请求后互相覆盖。
 */
export interface AgentTeamResources {
	/** 已按界面语言解析插件名称的展示文档；`setDocument` 的函数式更新拿到的仍是原始文档。 */
	readonly document?: AgentTeamDocument;
	readonly setDocument: Dispatch<SetStateAction<AgentTeamDocument | undefined>>;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly plugins: readonly BlueprintDisplayPlugin[];
	readonly loading: boolean;
	readonly error?: string;
	readonly setError: (error: string | undefined) => void;
	readonly reload: () => Promise<void>;
}

export function useAgentTeamResources(): AgentTeamResources {
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [blueprints, setBlueprints] = useState<readonly AgentBlueprint[]>([]);
	const [plugins, setPlugins] = useState<readonly BlueprintDisplayPlugin[]>([]);
	const [capabilities, setCapabilities] = useState<readonly AgentCapabilityOption[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		void waitForCommittedPaint()
			.then(() => {
				if (cancelled) return;
				return loadAgentTeamConfigurationResources();
			})
			.then((resources) => {
				if (cancelled || !resources) return;
				setDocument(resources.document);
				setBlueprints(resources.blueprints);
				setPlugins(resources.plugins);
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

	/**
	 * 插件重铺预设后跟着刷新。
	 *
	 * 插件贡献的智能体与团队由提供方维护，装卸插件和开发态热重载都会在用户没动手的情况下改动
	 * 这份文档；不听这条事件，列表会一直停在旧阵容直到重启 App。blueprint 一起重取——人设与
	 * 头像同样随插件走。
	 */
	useEffect(() => {
		return window.vetta.agentTeams.onChanged(() => {
			void loadAgentTeamConfigurationResources()
				.then((resources) => {
					setDocument(resources.document);
					setBlueprints(resources.blueprints);
					setPlugins(resources.plugins);
					setCapabilities(resources.capabilities);
				})
				.catch(() => {
					// 后台刷新失败保持现状：用户没有发起任何操作，弹错只会平白打断他。
				});
		});
	}, []);

	const displayDocument = useLocalizedAgentTeamDocument(document);

	return {
		document: displayDocument,
		setDocument,
		blueprints,
		plugins,
		capabilities,
		loading,
		error,
		setError,
		reload,
	};
}

export function agentTeamErrorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

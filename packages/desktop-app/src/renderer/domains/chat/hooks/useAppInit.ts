import { useBatchTasks } from "@domains/batch-tasks/hooks/useBatchTasks";
import { useProjects } from "@domains/project/hooks/useProjects";
import { fetchServerInfo } from "@shared/lib/api";
import {
	defaultConversationCwdAtom,
	defaultImConversationCwdAtom,
	deployModeAtom,
	knowledgeBaseEnabledAtom,
	knowledgeProcessingCwdAtom,
	SELECTED_MODEL_STORAGE_KEY,
	selectedModelAtom,
	sessionExecutionModeAtom,
	workspacePathAtom,
} from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

export function useAppInit(): void {
	const setWorkspacePath = useSetAtom(workspacePathAtom);
	const setDefaultConversationCwd = useSetAtom(defaultConversationCwdAtom);
	const setDefaultImConversationCwd = useSetAtom(defaultImConversationCwdAtom);
	const setSelectedModel = useSetAtom(selectedModelAtom);
	const setSessionExecutionMode = useSetAtom(sessionExecutionModeAtom);
	const setDeployMode = useSetAtom(deployModeAtom);
	const setKnowledgeBaseEnabled = useSetAtom(knowledgeBaseEnabledAtom);
	const setKnowledgeProcessingCwd = useSetAtom(knowledgeProcessingCwdAtom);
	const { refreshProjects } = useProjects();
	const { refreshProjects: refreshBatchProjects } = useBatchTasks();

	useEffect(() => {
		// Fetch deploy mode from server
		void fetchServerInfo()
			.then((info) => setDeployMode(info.deploy_mode))
			.catch(console.error);
		// Sync workspace path from config file
		void window.vetta.config.get().then((config) => {
			if (config.workspacePath) {
				setWorkspacePath(config.workspacePath);
				localStorage.setItem("vetta-workspace-path", config.workspacePath);
			}
			if (config.defaultConversationCwd) {
				setDefaultConversationCwd(config.defaultConversationCwd);
			}
			if (config.defaultImConversationCwd) {
				setDefaultImConversationCwd(config.defaultImConversationCwd);
			}
			const executionMode = config.defaultExecutionMode ?? "full-access";
			setSessionExecutionMode(executionMode);
			localStorage.setItem("vetta-session-execution-mode", executionMode);
			setKnowledgeBaseEnabled(config.knowledgeBase?.enabled === true);
			if (config.knowledgeProcessingCwd) {
				setKnowledgeProcessingCwd(config.knowledgeProcessingCwd);
			}
		});
		// 恢复新会话全局模型偏好；无偏好时才回落到配置的 defaultModel。
		// （atom 已从 localStorage 初始化；此处再同步一次，并补写缺失的默认。）
		void window.vetta.models.get().then((modelsConfig) => {
			const saved = localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
			if (saved) {
				setSelectedModel(saved);
			} else if (modelsConfig.defaultModel) {
				setSelectedModel(modelsConfig.defaultModel);
				try {
					localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, modelsConfig.defaultModel);
				} catch {
					// ignore persistence errors (private mode / quota)
				}
			}
		});
		void refreshProjects().catch(console.error);
		void refreshBatchProjects().catch(console.error);
		// 远程模型 & credits 余额已由 useAuth 在 token 变化时统一拉取，这里不再重复。
		// 注意：此处之前有一段 cleanup `currentUnsubscribe?.()`，但 useAppInit
		// 挂在 RootLayout 上、与应用同生命周期，cleanup 永远不会触发——已删除。
		// session 订阅的清理统一由 useSessionManager.openSession 管理。
	}, [
		setWorkspacePath,
		setDefaultConversationCwd,
		setSelectedModel,
		setSessionExecutionMode,
		setDeployMode,
		refreshProjects,
		refreshBatchProjects,
		setDefaultImConversationCwd,
		setKnowledgeBaseEnabled,
		setKnowledgeProcessingCwd,
	]);
}

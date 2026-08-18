import { KnowledgeHistoryPanelView } from "@vetta/theme-ui/activity";
import { useKnowledgeHistoryPanelModel } from "../hooks/useKnowledgeHistoryPanelModel";

/**
 * 活动面板里的「知识库加工历史」：列出加工 cwd 下的每一轮加工 session（只显示时间），
 * 点击跳转到对应只读 viewer。仅在查看加工 session 时显示，且是该上下文唯一的 tab。
 * 默认只展示前 10 条，可「加载全部」展开；顶部提供「清空记录」。
 */
export function KnowledgeHistoryPanel({ cwd }: { cwd: string | null }): JSX.Element {
	const model = useKnowledgeHistoryPanelModel(cwd);

	return (
		<KnowledgeHistoryPanelView
			loading={model.loading}
			sessions={model.sessions}
			hasMore={model.hasMore}
			clearing={model.clearing}
			labels={model.labels}
			onOpen={model.onOpen}
			onClearRequest={model.onClearRequest}
			onExpand={model.onExpand}
		/>
	);
}

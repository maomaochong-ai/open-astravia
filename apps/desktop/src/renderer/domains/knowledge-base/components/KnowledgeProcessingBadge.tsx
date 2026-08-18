import { KnowledgeProcessingBadgeView } from "@vetta/theme-ui/knowledge";
import { useKnowledgeProcessingBadgeModel } from "../hooks/useKnowledgeProcessingBadgeModel";

/**
 * 顶栏标题右侧徽标：知识库后台加工（建立索引）进行中时显示，带 spin 动画。
 * 自订阅主进程加工状态，空闲时渲染 null。挂在 pageHeaderTitleBadgeAtom 插槽里，
 * 仅知识库页在 mount 时注入、unmount 时清除，其它页面不受影响。
 */
export function KnowledgeProcessingBadge(): JSX.Element | null {
	const model = useKnowledgeProcessingBadgeModel();
	if (!model.processing) return null;
	return <KnowledgeProcessingBadgeView label={model.label} />;
}

import type { SkillInfo } from "@preload/api";
import { useThemeComponent } from "@vetta/theme-sdk";
import { useCommandPanelModel } from "../../hooks/useCommandPanelModel";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";
import { CommandPanelView } from "./CommandPanelView";

export interface CommandPanelProps {
	open: boolean;
	onClose: () => void;
	onSelect: (skill: SkillInfo) => void;
	onSelectConnector: (connector: ConnectorGridItem) => void;
	/** 面板底部的一次性命令：打开系统图片 / 文件选择器。 */
	onSelectImages: () => void;
	onSelectFiles: () => void;
	/** 触发词原文（含 `/`）。 */
	filter: string;
	/** 当前会话/项目 cwd，用于列出项目级 skill 目录。 */
	cwd?: string;
	className?: string;
}

/**
 * 聊天输入框的命令面板：连接器宫格 + skill 列表 + 底部固定动作条。
 * 批量任务 / 自动化 dialog 用的是精简版 SkillPickerPanel，两者共用 SkillList。
 */
export function CommandPanel(props: CommandPanelProps): JSX.Element {
	const model = useCommandPanelModel(props);
	const ThemedCommandPanelView = useThemeComponent("chat.commandPanelView", CommandPanelView);
	return <ThemedCommandPanelView {...model.viewProps} />;
}

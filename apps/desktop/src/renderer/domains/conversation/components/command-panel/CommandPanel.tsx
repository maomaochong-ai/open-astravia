import type { SkillInfo } from "@preload/api";
import { useThemeComponent } from "@astravia-org/theme-sdk";
import { useCommandPanelModel } from "../../hooks/useCommandPanelModel";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";
import type { InputActionBarModel } from "../useInputActionBarModel";
import { CommandPanelView } from "./CommandPanelView";
import type { CommandPanelFileAction } from "./types";

export interface CommandPanelProps {
	/** 已由输入框 Connector 装配时直接复用，确保面板和激活胶囊来自同一动作模型。 */
	inputActions?: InputActionBarModel;
	open: boolean;
	onClose: () => void;
	/** icon 是从市场目录解析出的那张图，交给调用方在行内胶囊上复用。 */
	onSelect: (skill: SkillInfo, icon?: string) => void;
	onSelectConnector: (connector: ConnectorGridItem) => void;
	/** 触发词原文（含 `/`）。 */
	filter: string;
	/** 当前会话/项目 cwd，用于列出项目级 skill 目录。 */
	cwd?: string;
	className?: string;
	allowCompaction?: boolean;
	/**
	 * 「文件」分类的三段动作（添加文件 / 添加图片 / 引用对话中的文件）。
	 * 由输入框宿主注入——附件选择的实现在它那里，面板只负责呈现。
	 */
	fileActions?: readonly CommandPanelFileAction[];
	/** 左栏底部的「能力广场」入口；不传则整格不渲染。 */
	onOpenAbilityPlaza?: () => void;
	/** 详情栏的「在能力广场中查看」；不传则按钮不渲染（内置技能没有广场页面）。 */
	onOpenEntryInPlaza?: (entry: { readonly category: string; readonly id: string }) => void;
}

/**
 * 聊天输入框的「添加」面板：三栏（分类轨道 ｜ 搜索 + 列表 ｜ 详情），见 ADR-0175。
 * 批量任务 / 自动化 dialog 用的是精简版 SkillPickerPanel，两者共用 SkillList。
 */
export function CommandPanel(props: CommandPanelProps): JSX.Element {
	const model = useCommandPanelModel({
		...props,
		onOpenEntryInPlaza:
			props.onOpenEntryInPlaza === undefined
				? undefined
				: (entry) => props.onOpenEntryInPlaza?.({ category: entry.category, id: entry.id }),
	});
	const ThemedCommandPanelView = useThemeComponent("chat.commandPanelView", CommandPanelView);
	return <ThemedCommandPanelView {...model.viewProps} />;
}

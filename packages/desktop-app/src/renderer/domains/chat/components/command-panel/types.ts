import type { SkillInfo } from "@preload/api";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";

export interface SkillListLabels {
	/** source → 展示用的小标签（内置 / 插件 / 场景 …）；不传则不渲染这枚 badge。 */
	sourceLabel?: (source: string, type: SkillInfo["type"]) => string;
	emptyNoMatch: string;
	/** 空态卡片里的第二行提示（有过滤词但没命中）。 */
	emptyNoMatchHint: string;
	emptyNoSkills: string;
	/** 空态卡片里的第二行提示（本来就没有可用条目）。 */
	emptyNoSkillsHint: string;
}

export interface SkillListProps {
	items: readonly SkillInfo[];
	activeIndex: number;
	labels: SkillListLabels;
	filtering: boolean;
	/** 市场目录里的图标（`solar:xxx` 或图片 URL）；返回 undefined 时落 type 默认图。 */
	resolveIcon?: (skill: SkillInfo) => string | undefined;
	onHover: (index: number) => void;
	onSelect: (skill: SkillInfo) => void;
}

export interface CommandPanelLabels extends SkillListLabels {
	header: string;
	resultCount: string;
	connectorsSection: string;
}

export interface CommandPanelActionItem {
	id: string;
	label: string;
	icon?: React.ReactNode;
	active: boolean;
	onToggle: () => void;
}

export interface CommandPanelProps {
	/** 展开 / 收缩：命令区是 InputBar 的一种形态，不是浮层。 */
	open: boolean;
	/** 归一化后的过滤词（不含 `/`）。 */
	filter: string;
	items: readonly SkillInfo[];
	activeIndex: number;
	connectors: readonly ConnectorGridItem[];
	connectorColumns: number;
	actions: readonly CommandPanelActionItem[];
	labels: CommandPanelLabels;
	resolveIcon: (skill: SkillInfo) => string | undefined;
	panelRef: React.RefObject<HTMLDivElement | null>;
	className?: string;
	onHoverItem: (index: number) => void;
	onSelectItem: (skill: SkillInfo) => void;
	onSelectConnector: (connector: ConnectorGridItem) => void;
}

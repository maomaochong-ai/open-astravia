import type { SkillInfo } from "@preload/api";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";

export interface SkillListLabels {
	/** source → 展示用的小标签（内置 / 插件 / 场景 …）。 */
	sourceLabel: (source: string, type: SkillInfo["type"]) => string;
	emptyNoMatch: string;
	emptyNoSkills: string;
}

export interface SkillListProps {
	items: readonly SkillInfo[];
	activeIndex: number;
	labels: SkillListLabels;
	filtering: boolean;
	onHover: (index: number) => void;
	onSelect: (skill: SkillInfo) => void;
}

export interface CommandPanelLabels extends SkillListLabels {
	header: string;
	resultCount: string;
	connectorsSection: string;
}

/** 一次性命令（点开系统选择器等），与可开关的 action 区分开。 */
export interface CommandPanelCommandItem {
	id: string;
	label: string;
	icon: string;
	onSelect: () => void;
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
	commands: readonly CommandPanelCommandItem[];
	actions: readonly CommandPanelActionItem[];
	labels: CommandPanelLabels;
	panelRef: React.RefObject<HTMLDivElement | null>;
	className?: string;
	onHoverItem: (index: number) => void;
	onSelectItem: (skill: SkillInfo) => void;
	onSelectConnector: (connector: ConnectorGridItem) => void;
}

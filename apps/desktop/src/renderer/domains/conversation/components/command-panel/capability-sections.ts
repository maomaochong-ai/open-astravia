import type { SkillInfo } from "@preload/api";
import type { ConnectorGridItem } from "../../hooks/useConnectorGrid";

/**
 * 输入框「添加」面板的能力目录（ADR-0156）。
 *
 * 这里只做投影与排序：技能来自 `SkillInfo[]`、连接器来自 `ConnectorGridItem[]`、
 * 文件来自工具行的附件动作。各类的存储、权限与安装路径都不在这里，也不因为
 * 出现在同一个面板里而被统一成同一种东西。
 */
export type CapabilityKind = "files" | "skills" | "connectors" | "plugins" | "apps";

/**
 * 区段顺序固定：最常用的在前，最不常用的在后。
 * 不按数量动态排序——同一类条目每次都要在同一位置，否则用户每次打开都要重新找。
 */
export const CAPABILITY_SECTION_ORDER: readonly CapabilityKind[] = ["files", "skills", "connectors", "plugins", "apps"];

export interface CapabilityFileAction {
	readonly id: "addFile" | "addImage" | "referenceConversationFile";
	readonly label: string;
	readonly icon?: string;
	readonly onSelect: () => void;
}

export interface CapabilitySectionInput {
	readonly files?: readonly CapabilityFileAction[];
	readonly skills?: readonly SkillInfo[];
	readonly connectors?: readonly ConnectorGridItem[];
	readonly plugins?: readonly CapabilityPluginEntry[];
	readonly apps?: readonly CapabilityAppEntry[];
}

export interface CapabilityPluginEntry {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
}

export interface CapabilityAppEntry {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	/** 已下线/未发布的应用仍然列出来，但要标明状态。 */
	readonly status?: "published" | "unpublished" | "never";
}

export interface CapabilitySection {
	readonly kind: CapabilityKind;
	readonly titleKey: string;
	/** 仅这一类参与过滤词筛选；文件区段是直接动作，不参与。 */
	readonly searchable: boolean;
	readonly itemCount: number;
}

const TITLE_KEYS: Record<CapabilityKind, string> = {
	files: "slashPanel.sections.files",
	skills: "slashPanel.sections.skills",
	connectors: "slashPanel.sections.connectors",
	plugins: "slashPanel.sections.plugins",
	apps: "slashPanel.sections.apps",
};

const SEARCHABLE: Record<CapabilityKind, boolean> = {
	files: false,
	skills: true,
	connectors: true,
	plugins: true,
	apps: true,
};

function countOf(kind: CapabilityKind, input: CapabilitySectionInput): number {
	switch (kind) {
		case "files":
			return input.files?.length ?? 0;
		case "skills":
			return input.skills?.length ?? 0;
		case "connectors":
			return input.connectors?.length ?? 0;
		case "plugins":
			return input.plugins?.length ?? 0;
		case "apps":
			return input.apps?.length ?? 0;
	}
}

/**
 * 有内容的区段，按 {@link CAPABILITY_SECTION_ORDER} 排列。
 * 空区段不返回——面板上不出现空标题。
 */
export function resolveCapabilitySections(input: CapabilitySectionInput): CapabilitySection[] {
	const sections: CapabilitySection[] = [];
	for (const kind of CAPABILITY_SECTION_ORDER) {
		const itemCount = countOf(kind, input);
		if (itemCount === 0) continue;
		sections.push({ kind, titleKey: TITLE_KEYS[kind], searchable: SEARCHABLE[kind], itemCount });
	}
	return sections;
}

/**
 * 过滤词是否作用到这个区段的条目。
 *
 * 文件区段是直接动作（添加文件 / 添加图片），没有可过滤的条目，因此永远返回 false：
 * 用户输入过滤词时它仍然原样显示，不会被筛掉。
 */
export function sectionAppliesFilter(section: CapabilitySection): boolean {
	return section.searchable;
}

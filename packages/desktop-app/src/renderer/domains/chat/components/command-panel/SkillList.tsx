import type { SkillInfo } from "@preload/api";
import { motion } from "motion/react";
import type { SkillListProps } from "./types";

/** 单行 32px：20px 图标 + 名称 + source 小标签 + 同行右侧灰色描述。 */
function SkillListItem({
	skill,
	index,
	active,
	sourceLabel,
	onHover,
	onSelect,
}: {
	skill: SkillInfo;
	index: number;
	active: boolean;
	sourceLabel: string;
	onHover: () => void;
	onSelect: () => void;
}): JSX.Element {
	const isScene = skill.type === "scene";
	return (
		<button
			type="button"
			data-index={index}
			onMouseEnter={onHover}
			onClick={onSelect}
			title={skill.description || skill.name}
			className="relative flex h-8 w-full items-center gap-2 px-4 text-left transition-colors"
			style={{
				background: active ? "color-mix(in srgb, var(--primary) 9%, transparent)" : "transparent",
			}}
		>
			{active && (
				<motion.span
					layoutId="command-panel-active-marker"
					className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
					transition={{ type: "spring", stiffness: 500, damping: 32 }}
				/>
			)}
			<span
				className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
					isScene ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
				}`}
			>
				<span
					className={`${isScene ? "icon-[solar--clapperboard-open-linear]" : "icon-[solar--magic-stick-linear]"} h-3 w-3`}
				/>
			</span>
			<span className="shrink-0 truncate text-[12.5px] font-medium text-foreground">
				{skill.alias || skill.name}
			</span>
			<span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[9px] font-medium text-muted-foreground/60">
				{sourceLabel}
			</span>
			{skill.description && (
				<span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground/50">
					{skill.description}
				</span>
			)}
		</button>
	);
}

/**
 * skill 与场景合并后的单列列表。
 * 排序在 useSkillList 里完成（调用次数 → 类别 → 最近使用 → 名称），这里只负责渲染。
 */
export function SkillList({
	items,
	activeIndex,
	labels,
	filtering,
	onHover,
	onSelect,
}: SkillListProps): JSX.Element {
	if (items.length === 0) {
		return (
			<div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground/50">
				{filtering ? labels.emptyNoMatch : labels.emptyNoSkills}
			</div>
		);
	}
	return (
		<div className="py-1">
			{items.map((skill, index) => (
				<SkillListItem
					key={`${skill.type}-${skill.source}-${skill.name}`}
					skill={skill}
					index={index}
					active={index === activeIndex}
					sourceLabel={labels.sourceLabel(skill.source, skill.type)}
					onHover={() => onHover(index)}
					onSelect={() => onSelect(skill)}
				/>
			))}
		</div>
	);
}

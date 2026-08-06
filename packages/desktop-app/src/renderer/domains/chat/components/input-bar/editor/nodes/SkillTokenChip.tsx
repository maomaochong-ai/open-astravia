import { useSkillTokenMeta } from "@domains/chat/hooks/useSkillTokenMeta";
import { SkillTypeIcon } from "@vetta/theme-ui/skills";
import { TokenChip } from "./TokenChip";

/**
 * 行内 skill 胶囊。命令区插入时会带上别名与图标；从文本还原（重编辑回填、
 * 外部写入）时节点上只有 slug，此时回查 skill 清单补齐展示信息——
 * 否则同一枚胶囊在「刚插入」与「重编辑后」会长得不一样。
 */
export function SkillTokenChip({
	name,
	alias,
	icon,
}: {
	name: string;
	alias?: string;
	icon?: string;
}): JSX.Element {
	const resolve = useSkillTokenMeta();
	const meta = resolve(name);
	const resolvedIcon = icon ?? meta?.icon;
	return (
		<TokenChip
			iconNode={<SkillTypeIcon type="skill" icon={resolvedIcon} className="h-3 w-3" />}
			label={alias || meta?.label || name}
			title={name}
		/>
	);
}

import { useTranslation } from "react-i18next";
import { SkillTagGroupView } from "@vetta/theme-ui/skills";
import type { ActionState, MergedSkill } from "../hooks/useSkillsPageModel";
import { SceneCard } from "./SceneCard";
import { SkillCard } from "./SkillCard";

export function SkillTagGroup({
	tag,
	skills,
	onInstall,
	onToggle,
	onUninstall,
	onPreview,
	actionStates,
}: {
	tag: string;
	skills: MergedSkill[];
	onInstall: (skill: MergedSkill) => void;
	onToggle: (name: string) => void;
	onUninstall: (name: string, type: "skill" | "scene") => void;
	onPreview?: (skill: MergedSkill) => void;
	actionStates: Record<string, ActionState>;
}): JSX.Element {
	const { t } = useTranslation("skills");
	const enabledInGroup = skills.filter((s) => s.enabled).length;
	const isScene = skills[0]?.type === "scene";

	return (
		<SkillTagGroupView
			tag={tag}
			skillCount={skills.length}
			isScene={isScene}
			enabledCountLabel={
				enabledInGroup > 0 ? t("group.enabledCount", { n: enabledInGroup }) : undefined
			}
			items={skills.map((skill) =>
				isScene ? (
					<SceneCard
						key={skill.name}
						scene={skill}
						onInstall={onInstall}
						onToggle={onToggle}
						onUninstall={onUninstall}
						onPreview={onPreview}
						actionState={actionStates[skill.name] ?? "idle"}
					/>
				) : (
					<SkillCard
						key={skill.name}
						skill={skill}
						onInstall={onInstall}
						onToggle={onToggle}
						onUninstall={onUninstall}
						onPreview={onPreview}
						actionState={actionStates[skill.name] ?? "idle"}
					/>
				),
			)}
		/>
	);
}

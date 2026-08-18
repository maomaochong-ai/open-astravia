import { SkillCardView } from "@vetta/theme-ui/skills";
import { useTranslation } from "react-i18next";
import type { ActionState, MergedSkill } from "../hooks/useSkillsPageModel";

export function SkillCard({
	skill,
	onInstall,
	onToggle,
	onUninstall,
	onPreview,
	actionState,
}: {
	skill: MergedSkill;
	onInstall: (skill: MergedSkill) => void;
	onToggle: (name: string) => void;
	onUninstall: (name: string, type: "skill" | "scene") => void;
	onPreview?: (skill: MergedSkill) => void;
	actionState: ActionState;
}): JSX.Element {
	const { t } = useTranslation("skills");
	return (
		<SkillCardView
			skill={skill}
			isLoading={actionState === "loading"}
			previewable={!!onPreview}
			onInstall={() => onInstall(skill)}
			onToggle={() => onToggle(skill.name)}
			onUninstall={() => onUninstall(skill.name, skill.type)}
			onPreview={onPreview ? () => onPreview(skill) : undefined}
			labels={{
				custom: t("card.custom"),
				general: t("card.general"),
				updatable: t("card.updatable"),
				noDescription: t("card.noDescription"),
				readonly: t("card.readonly"),
				update: t("actions.update"),
				uninstall: t("actions.uninstall"),
				install: t("actions.install"),
			}}
		/>
	);
}

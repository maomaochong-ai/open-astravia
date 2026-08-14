import { SceneCardView } from "@vetta/theme-ui/skills";
import { useTranslation } from "react-i18next";
import type { ActionState, MergedSkill } from "../hooks/useSkillsPageModel";

export function SceneCard({
	scene,
	onInstall,
	onToggle,
	onUninstall,
	onPreview,
	actionState,
}: {
	scene: MergedSkill;
	onInstall: (s: MergedSkill) => void;
	onToggle: (name: string) => void;
	onUninstall: (name: string, type: "skill" | "scene") => void;
	onPreview?: (scene: MergedSkill) => void;
	actionState: ActionState;
}): JSX.Element {
	const { t } = useTranslation("skills");
	return (
		<SceneCardView
			scene={scene}
			isLoading={actionState === "loading"}
			previewable={!!onPreview}
			onInstall={() => onInstall(scene)}
			onToggle={() => onToggle(scene.name)}
			onUninstall={() => onUninstall(scene.name, scene.type)}
			onPreview={onPreview ? () => onPreview(scene) : undefined}
			labels={{
				custom: t("card.custom"),
				general: t("card.general"),
				updatable: t("card.updatable"),
				noDescription: t("card.noDescription"),
				readonly: t("card.readonly"),
				update: t("actions.update"),
				uninstall: t("actions.uninstall"),
				install: t("actions.install"),
				use: t("actions.use"),
				generalReadonly: t("scene.generalReadonly"),
				localReadonly: t("scene.localReadonly"),
				running: t("scene.running"),
				installed: t("scene.installed"),
			}}
		/>
	);
}

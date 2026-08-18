import { AchievementTitle as ThemeAchievementTitle } from "@vetta/theme-ui/settings";
import { ACHIEVEMENT_SCENE_LAYOUT } from "../achievement-scene-layout";
import { ACHIEVEMENT_UI_ASSETS } from "../achievement-ui-assets";

export function AchievementTitle({ title }: { title: string }): JSX.Element {
	return (
		<ThemeAchievementTitle
			title={title}
			layout={ACHIEVEMENT_SCENE_LAYOUT.title}
			titleImageUrl={ACHIEVEMENT_UI_ASSETS.title}
			titleTextOffsetY={ACHIEVEMENT_SCENE_LAYOUT.titleTextOffsetY}
		/>
	);
}

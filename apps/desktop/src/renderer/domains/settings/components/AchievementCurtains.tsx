import { AchievementCurtains as ThemeAchievementCurtains } from "@vetta/theme-ui/settings";
import { ACHIEVEMENT_SCENE_LAYOUT } from "../achievement-scene-layout";
import { ACHIEVEMENT_UI_ASSETS } from "../achievement-ui-assets";

export function AchievementCurtains(): JSX.Element {
	return (
		<ThemeAchievementCurtains
			layout={ACHIEVEMENT_SCENE_LAYOUT.curtain}
			assets={ACHIEVEMENT_UI_ASSETS.curtain}
		/>
	);
}

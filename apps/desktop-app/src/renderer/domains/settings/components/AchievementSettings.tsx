import { AchievementSettingsView } from "./AchievementSettingsView";
import { useAchievementSettingsModel } from "./useAchievementSettingsModel";

export function AchievementSettings(): JSX.Element {
	return <AchievementSettingsView {...useAchievementSettingsModel()} />;
}

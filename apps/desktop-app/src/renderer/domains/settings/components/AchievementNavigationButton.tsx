import { AchievementNavigationButtonView } from "@vetta/theme-ui/settings";
import { ACHIEVEMENT_UI_ASSETS } from "../achievement-ui-assets";

interface AchievementNavigationButtonProps {
	disabled: boolean;
	direction: "previous" | "next";
	label: string;
	onClick: () => void;
}

export function AchievementNavigationButton(props: AchievementNavigationButtonProps): JSX.Element {
	return <AchievementNavigationButtonView {...props} assets={ACHIEVEMENT_UI_ASSETS.navigation} />;
}

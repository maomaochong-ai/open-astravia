import { AchievementSettingsView as ThemeAchievementSettingsView } from "@vetta/theme-ui/settings";
import { AchievementCarousel } from "./AchievementCarousel";
import { AchievementPromotionDialog } from "./AchievementPromotionDialog";
import type { AchievementSettingsModel } from "./useAchievementSettingsModel";

export function AchievementSettingsView(model: AchievementSettingsModel): JSX.Element {
	return (
		<ThemeAchievementSettingsView
			setSelectorLabel={model.labels.setSelector}
			selectedSetId={model.selectedSetId}
			setOptions={model.setOptions}
			onSelectSetId={model.onSelectSetId}
			carousel={
				<AchievementCarousel
					achievements={model.achievements}
					currentIndex={model.currentIndex}
					focusSizeEnabled={model.focusSizeEnabled}
					subtitleKey={model.subtitleKey}
					usageStats={model.usageStats}
				/>
			}
			promotionDialog={
				model.promotedAchievement ? (
					<AchievementPromotionDialog
						achievement={model.promotedAchievement}
						onComplete={model.onPromotionComplete}
					/>
				) : null
			}
		/>
	);
}

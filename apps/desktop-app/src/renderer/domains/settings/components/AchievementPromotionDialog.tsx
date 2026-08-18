import { useTranslation } from "react-i18next";
import {
	AchievementPromotionBadge3D,
	AchievementPromotionConfetti,
	AchievementPromotionDialogView,
} from "@vetta/theme-ui/settings";
import type { Achievement } from "../achievements";

interface AchievementPromotionDialogProps {
	achievement: Achievement;
	onComplete: () => void;
}

export function AchievementPromotionDialog({
	achievement,
	onComplete,
}: AchievementPromotionDialogProps): JSX.Element {
	const { t } = useTranslation("settings");
	const name = t(`achievement.stages.${achievement.id}.name`, {
		defaultValue: achievement.id,
	});

	return (
		<AchievementPromotionDialogView
			onComplete={onComplete}
			labels={{
				title: t("achievement.promotion.title"),
				stageName: t("achievement.promotion.stageName", { name }),
			}}
			renderBadge={(handlers) => (
				<AchievementPromotionBadge3D imageUrl={achievement.imageUrl} {...handlers} />
			)}
			renderConfetti={(triggerToken) => (
				<AchievementPromotionConfetti triggerToken={triggerToken} />
			)}
		/>
	);
}

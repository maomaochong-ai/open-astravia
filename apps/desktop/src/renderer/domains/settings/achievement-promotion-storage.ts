import type { Achievement, AchievementId } from "./achievements";

const STORAGE_KEY = "vetta-achievement-highest-seen";

function findAchievementIndex(achievements: readonly Achievement[], id: string | null): number {
	if (!id) return -1;
	return achievements.findIndex((achievement) => achievement.id === id);
}

export function detectAchievementPromotion(
	setId: string,
	achievements: readonly Achievement[],
	currentIndex: number,
): AchievementId | null {
	const setStorageKey = `${STORAGE_KEY}:${setId}`;
	const storedId = localStorage.getItem(setStorageKey);
	const storedIndex = findAchievementIndex(achievements, storedId);
	const currentAchievement = achievements[currentIndex];
	if (!currentAchievement) return null;

	localStorage.setItem(setStorageKey, currentAchievement.id);
	if (storedId === null || currentIndex <= storedIndex) return null;
	return currentAchievement.id;
}

import type { CornerImageFrameDecoration } from "@vetta/theme-sdk";
import classicAchievementSetData from "./achievement-set-data/classic.json";
import fanrenAchievementSetData from "./achievement-set-data/fanren.json";
import achievementSetIndexData from "./achievement-sets.json";

export type AchievementId = string;

export interface Achievement {
	frameDecoration: CornerImageFrameDecoration;
	frameUrl: string;
	id: AchievementId;
	imageUrl: string;
	targetActiveMs: number;
	surfaceColors: {
		backgroundColor: string;
		borderColor: string;
	};
}

export interface AchievementSet {
	achievements: readonly Achievement[];
	id: string;
	labelKey: string;
	subtitleKey: string;
}

interface AchievementSetIndexEntry {
	id: string;
	labelKey: string;
	source: string;
	subtitleKey: string;
}

interface AchievementSetIndexData {
	defaultSetId: string;
	sets: readonly AchievementSetIndexEntry[];
}

interface AchievementSetData {
	achievements: readonly Achievement[];
	id: string;
}

const BUNDLED_ACHIEVEMENT_SET_DATA: Readonly<Record<string, AchievementSetData>> = {
	classic: classicAchievementSetData,
	fanren: fanrenAchievementSetData,
};

function validateAchievementSet(set: AchievementSet): void {
	if (set.achievements.length === 0) {
		throw new Error(`Achievement set "${set.id}" must include at least one achievement.`);
	}

	const ids = new Set<string>();
	let previousTargetActiveMs = Number.NEGATIVE_INFINITY;
	for (const achievement of set.achievements) {
		if (ids.has(achievement.id)) {
			throw new Error(`Achievement set "${set.id}" contains duplicate id "${achievement.id}".`);
		}
		ids.add(achievement.id);
		if (achievement.targetActiveMs < previousTargetActiveMs) {
			throw new Error(`Achievement set "${set.id}" targetActiveMs values must be sorted.`);
		}
		previousTargetActiveMs = achievement.targetActiveMs;
	}
}

function resolveBundledAchievementSet(entry: AchievementSetIndexEntry): AchievementSet {
	const data = BUNDLED_ACHIEVEMENT_SET_DATA[entry.source];
	if (!data) {
		throw new Error(`Achievement set source "${entry.source}" is not registered.`);
	}
	if (data.id !== entry.id) {
		throw new Error(`Achievement set "${entry.id}" resolved to data "${data.id}".`);
	}
	return {
		achievements: data.achievements,
		id: entry.id,
		labelKey: entry.labelKey,
		subtitleKey: entry.subtitleKey,
	};
}

function loadAchievementSets(indexData: AchievementSetIndexData): readonly AchievementSet[] {
	if (indexData.sets.length === 0) {
		throw new Error("At least one achievement set is required.");
	}

	const sets = indexData.sets.map(resolveBundledAchievementSet);
	const setIds = new Set<string>();
	for (const set of sets) {
		if (setIds.has(set.id)) {
			throw new Error(`Duplicate achievement set id "${set.id}".`);
		}
		setIds.add(set.id);
		validateAchievementSet(set);
	}

	if (!setIds.has(indexData.defaultSetId)) {
		throw new Error(`Default achievement set "${indexData.defaultSetId}" does not exist.`);
	}

	return sets;
}

const typedAchievementSetIndexData = achievementSetIndexData as AchievementSetIndexData;

export const DEFAULT_ACHIEVEMENT_SET_ID = typedAchievementSetIndexData.defaultSetId;

export const ACHIEVEMENT_SETS = loadAchievementSets(typedAchievementSetIndexData);

export const ACHIEVEMENTS =
	ACHIEVEMENT_SETS.find((set) => set.id === DEFAULT_ACHIEVEMENT_SET_ID)?.achievements ??
	ACHIEVEMENT_SETS[0].achievements;

export function getAchievementSetById(id: string): AchievementSet {
	return ACHIEVEMENT_SETS.find((set) => set.id === id) ?? ACHIEVEMENT_SETS[0];
}

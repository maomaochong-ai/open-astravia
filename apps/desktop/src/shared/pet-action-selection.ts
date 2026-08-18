import {
	getPetActionById,
	getPetActionsByGroup,
	type PetActionDurationRange,
	type PetActionGroupId,
	type PetActionId,
} from "./pet-actions.js";

interface PetActionGroupWeight {
	readonly groupId: PetActionGroupId;
	readonly weight: number;
}

const IDLE_ACTION_GROUPS: readonly PetActionGroupId[] = ["idle", "resting"];

const AUTO_ACTION_GROUP_WEIGHTS = {
	overnight: [
		{ groupId: "resting", weight: 4 },
		{ groupId: "idle", weight: 1 },
	],
	workday: [
		{ groupId: "working", weight: 4 },
		{ groupId: "resting", weight: 2 },
		{ groupId: "idle", weight: 1 },
		{ groupId: "feedback", weight: 1 },
	],
	evening: [
		{ groupId: "resting", weight: 3 },
		{ groupId: "idle", weight: 2 },
		{ groupId: "feedback", weight: 1 },
		{ groupId: "working", weight: 1 },
	],
	night: [
		{ groupId: "resting", weight: 4 },
		{ groupId: "idle", weight: 1 },
		{ groupId: "feedback", weight: 1 },
	],
} satisfies Record<string, readonly PetActionGroupWeight[]>;

function getAutoActionPeriod(date: Date): keyof typeof AUTO_ACTION_GROUP_WEIGHTS {
	const hour = date.getHours();
	if (hour < 7) return "overnight";
	if (hour >= 9 && hour < 18) return "workday";
	if (hour >= 18 && hour < 23) return "evening";
	return "night";
}

function repeatActionIds(actionIds: readonly PetActionId[], weight: number): PetActionId[] {
	const repeated: PetActionId[] = [];
	for (let index = 0; index < weight; index += 1) {
		repeated.push(...actionIds);
	}
	return repeated;
}

export function getIdlePetActionIds(): PetActionId[] {
	return IDLE_ACTION_GROUPS.flatMap((groupId) => getPetActionsByGroup(groupId).map((action) => action.id));
}

export function getWeightedPetActionIdsForNow(date = new Date()): PetActionId[] {
	return AUTO_ACTION_GROUP_WEIGHTS[getAutoActionPeriod(date)].flatMap(({ groupId, weight }) =>
		repeatActionIds(
			getPetActionsByGroup(groupId).map((action) => action.id),
			weight,
		),
	);
}

export function getPetActionDurationRange(actionId: PetActionId): PetActionDurationRange {
	return getPetActionById(actionId).autoDuration;
}

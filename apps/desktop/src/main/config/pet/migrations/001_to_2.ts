import type { ConfigRecord, VersionedConfigMigration } from "@vetta/toolkit/versioned-config";
import { PET_ACTIONS, type PetActionId } from "../../../../shared/pet-actions.js";

const PET_ACTION_LEGACY_ID_MIGRATION: Record<string, PetActionId> = {
	sleep: "stoat_sleep_lie_on_cushion",
	workout: "stoat_stand_lift_barbell_one_hand_fast",
	typing: "stoat_work_laptop_typing_desk_cushion",
	music: "stoat_listen_music_headphones_nod",
	hula: "stoat_spin_color_hula_hoop",
	"jump-rope": "stoat_skip_rope_jump",
	tea: "stoat_sit_cushion_drink_tea_slow",
};

const PET_ACTION_CURRENT_TO_LEGACY_ID = new Map<PetActionId, string>(
	Object.entries(PET_ACTION_LEGACY_ID_MIGRATION).map(([legacyId, actionId]) => [actionId, legacyId]),
);

function migratePetActionId(value: unknown): unknown {
	if (typeof value !== "string") return value;
	return PET_ACTION_LEGACY_ID_MIGRATION[value] ?? value;
}

function migratePetVideoBaseSizeByAction(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return value;
	}

	const rawSizes = value as ConfigRecord;
	const migratedSizes: ConfigRecord = {};
	for (const action of PET_ACTIONS) {
		const legacyId = PET_ACTION_CURRENT_TO_LEGACY_ID.get(action.id);
		migratedSizes[action.id] = rawSizes[action.id] ?? (legacyId ? rawSizes[legacyId] : undefined);
	}
	return migratedSizes;
}

export const petConfigMigration001To2: VersionedConfigMigration = {
	fromVersion: 1,
	toVersion: 2,
	migrate(config) {
		return {
			...config,
			defaultActionId: migratePetActionId(config.defaultActionId),
			videoBaseSizeByAction: migratePetVideoBaseSizeByAction(config.videoBaseSizeByAction),
		};
	},
};

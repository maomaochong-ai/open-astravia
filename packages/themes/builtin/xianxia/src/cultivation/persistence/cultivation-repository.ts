import {
	type ThemeStorage,
	type ThemeStorageStatus,
	useThemeStorage,
} from "@vetta-org/theme-sdk";
import { useMemo } from "react";
import { isSameCultivationHistory } from "../cultivation-history";
import { isSameCultivationSnapshot } from "../computeCultivation";
import type { CultivationState } from "../types";
import {
	CULTIVATION_HISTORY_STORAGE_KEY,
	CULTIVATION_STORAGE_KEY,
	toCultivationHistoryStorageValue,
	toCultivationSnapshotStorageValue,
} from "./cultivation-storage.schema";
import { readCultivationStorage } from "./migrations/read-cultivation-storage";

export interface CultivationRepository {
	readonly status: ThemeStorageStatus;
	getSnapshot(): string;
	load(): CultivationState | null;
	save(state: CultivationState): boolean;
	subscribe(listener: () => void): () => void;
}

function createCultivationRepository(storage: ThemeStorage): CultivationRepository {
	const read = () =>
		readCultivationStorage(
			storage.get(CULTIVATION_STORAGE_KEY),
			storage.get(CULTIVATION_HISTORY_STORAGE_KEY),
		);

	return {
		get status() {
			return storage.status;
		},
		getSnapshot() {
			return `${storage.status}:${JSON.stringify([
				storage.get(CULTIVATION_STORAGE_KEY),
				storage.get(CULTIVATION_HISTORY_STORAGE_KEY),
			])}`;
		},
		load() {
			return read().state;
		},
		save(state) {
			const stored = read();
			const historyValueExists = storage.get(CULTIVATION_HISTORY_STORAGE_KEY) !== undefined;
			const historyChanged =
				!stored.state || !isSameCultivationHistory(stored.state.history, state.history);
			const shouldWriteHistory =
				stored.rewriteHistory ||
				(historyChanged &&
					(historyValueExists ||
						state.history.dailyScores.length > 0 ||
						state.history.dailyMetrics.length > 0));
			const shouldWriteSnapshot =
				stored.rewriteSnapshot ||
				!stored.state ||
				!isSameCultivationSnapshot(stored.state.snapshot, state.snapshot);

			if (shouldWriteHistory) {
				storage.set(
					CULTIVATION_HISTORY_STORAGE_KEY,
					toCultivationHistoryStorageValue(state.history, state.snapshot.updatedAt),
				);
			}
			if (shouldWriteSnapshot) {
				storage.set(CULTIVATION_STORAGE_KEY, toCultivationSnapshotStorageValue(state.snapshot));
			}
			return shouldWriteHistory || shouldWriteSnapshot;
		},
		subscribe(listener) {
			return storage.subscribe(listener);
		},
	};
}

export function useCultivationRepository(): CultivationRepository {
	const storage = useThemeStorage();
	return useMemo(() => createCultivationRepository(storage), [storage]);
}

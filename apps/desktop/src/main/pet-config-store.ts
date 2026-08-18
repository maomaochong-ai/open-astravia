import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { createVersionedJsonConfigStore } from "@vetta/toolkit/config-store";
import { normalizePetConfig, type PetConfig } from "../shared/pet-config.js";
import { migratePetConfig } from "./config/pet/migrate-config.js";
import { getAppLogger } from "./logger.js";
import { broadcastPetConfigChanged } from "./pet/pet-config-events.js";

const PET_CONFIG_PATH = join(getVettaHomePath(), "pet-config.json");
const log = getAppLogger("pet-config");

const petConfigStore = createVersionedJsonConfigStore<PetConfig>({
	path: PET_CONFIG_PATH,
	name: "pet",
	normalize: normalizePetConfig,
	migrate: migratePetConfig,
	logger: log,
});

export async function readPetConfig(): Promise<PetConfig> {
	return petConfigStore.read();
}

export function readPetConfigSync(): PetConfig {
	return petConfigStore.readSync();
}

export async function writePetConfig(config: PetConfig): Promise<void> {
	await petConfigStore.write(config);
	broadcastPetConfigChanged(config);
}

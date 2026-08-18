import type { PetConfig } from "../../shared/pet-config.js";
import { PET_CONFIG_CHANGED_CHANNEL } from "../../shared/pet-ipc.js";
import { getMainWindow } from "../window-manager.js";

export function broadcastPetConfigChanged(config: PetConfig): void {
	const mainWindow = getMainWindow();
	if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
	mainWindow.webContents.send(PET_CONFIG_CHANGED_CHANNEL, config);
}

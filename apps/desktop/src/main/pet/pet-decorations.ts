import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { PetDecoration } from "../../preload/api-types/pet.js";
import { allowProjectRoot } from "../ipc/fs.js";
import { MEDIA_PROTOCOL_SCHEME } from "../media-protocol.js";

const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const buildDir = app.isPackaged ? join(process.resourcesPath, "build") : join(appRoot, "build");
const petMediaDir = join(buildDir, "pet");

const PET_DECORATIONS = [
	{
		id: "monitor",
		fileName: "blank_black_computer_monitor.png",
		label: "Monitor",
		labelKey: "settings.decoration.items.monitor",
	},
	{
		id: "santa",
		fileName: "stoat_christmas_santa_outfit.png",
		label: "Santa outfit",
		labelKey: "settings.decoration.items.santa",
	},
	{
		id: "business",
		fileName: "stoat_business_suit_lawyer.png",
		label: "Business outfit",
		labelKey: "settings.decoration.items.business",
	},
	{
		id: "office",
		fileName: "stoat_pray_microsoft_office.png",
		label: "Office prayer",
		labelKey: "settings.decoration.items.office",
	},
	{
		id: "peeking-monitor",
		fileName: "stoat_peeking_from_monitor.png",
		label: "Peeking from monitor",
		labelKey: "settings.decoration.items.peekingMonitor",
	},
	{
		id: "dragon-boat",
		fileName: "stoat_dragon_boat_festival.png",
		label: "Dragon Boat decoration",
		labelKey: "settings.decoration.items.dragonBoat",
	},
] as const;

export function getPetDecorations(): PetDecoration[] {
	allowProjectRoot(petMediaDir);
	return PET_DECORATIONS.map((decoration) => {
		const path = join(petMediaDir, decoration.fileName);
		return {
			...decoration,
			found: existsSync(path),
			url: `${MEDIA_PROTOCOL_SCHEME}://local/stream?path=${encodeURIComponent(path)}`,
		};
	});
}

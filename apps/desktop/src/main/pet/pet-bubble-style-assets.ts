import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { PetBubbleStyleAsset } from "../../preload/api-types/pet.js";
import { PET_BUBBLE_STYLES } from "../../shared/pet-bubbles.js";
import { allowProjectRoot } from "../ipc/fs.js";
import { MEDIA_PROTOCOL_SCHEME } from "../media-protocol.js";

const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const buildDir = app.isPackaged ? join(process.resourcesPath, "build") : join(appRoot, "build");
const petMediaDir = join(buildDir, "pet");

export function getPetBubbleStyleAssets(): PetBubbleStyleAsset[] {
	allowProjectRoot(petMediaDir);
	return PET_BUBBLE_STYLES.map((style) => {
		if (!style.decor) {
			return {
				id: style.id,
				found: true,
			};
		}

		const path = join(petMediaDir, style.decor.fileName);
		return {
			id: style.id,
			found: existsSync(path),
			url: `${MEDIA_PROTOCOL_SCHEME}://local/stream?path=${encodeURIComponent(path)}`,
		};
	});
}

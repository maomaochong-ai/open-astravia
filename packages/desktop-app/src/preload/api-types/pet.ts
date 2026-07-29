import type { PetBubbleStyleId } from "../../shared/pet-bubbles.js";
import type { PetConfig } from "../../shared/pet-config.js";

export type PetDecorationLabelKey =
	| "settings.decoration.items.monitor"
	| "settings.decoration.items.santa"
	| "settings.decoration.items.business"
	| "settings.decoration.items.office"
	| "settings.decoration.items.peekingMonitor"
	| "settings.decoration.items.dragonBoat";

export interface PetDecoration {
	id: string;
	fileName: string;
	label: string;
	labelKey: PetDecorationLabelKey;
	found: boolean;
	url: string;
}

export interface PetBubbleStyleAsset {
	id: PetBubbleStyleId;
	found: boolean;
	url?: string;
}

export type PetConfigListener = (config: PetConfig) => void;

export interface DesktopPetApi {
	getConfig(): Promise<PetConfig>;
	setConfig(patch: Partial<PetConfig>): Promise<PetConfig>;
	onConfigChanged(listener: PetConfigListener): () => void;
	show(): Promise<PetConfig>;
	hide(): Promise<PetConfig>;
	setAction(actionId: string): Promise<void>;
	getDecorations(): Promise<PetDecoration[]>;
	getBubbleStyleAssets(): Promise<PetBubbleStyleAsset[]>;
}

import plainStyle from "./pet-bubble-styles/plain.json";
import aprilFoolsStyle from "./pet-bubble-styles/stoat_april_fools_day_corner_border_set.json";
import childrenDayStyle from "./pet-bubble-styles/stoat_children_day_corner_border_set.json";
import christmasStyle from "./pet-bubble-styles/stoat_christmas_corner_border_set.json";
import dragonBoatStyle from "./pet-bubble-styles/stoat_dragon_boat_festival_corner_border_set.json";
import halloweenStyle from "./pet-bubble-styles/stoat_halloween_corner_border_set.json";
import laborDayStyle from "./pet-bubble-styles/stoat_labor_day_corner_border_set.json";
import midAutumnStyle from "./pet-bubble-styles/stoat_mid_autumn_festival_corner_border_set.json";
import nationalDayStyle from "./pet-bubble-styles/stoat_national_day_frame_border.json";
import qingmingStyle from "./pet-bubble-styles/stoat_qingming_festival_corner_border_set.json";
import songkranStyle from "./pet-bubble-styles/stoat_songkran_festival_corner_border_set.json";
import springFestivalStyle from "./pet-bubble-styles/stoat_spring_festival_corner_border_set.json";
import valentineDayStyle from "./pet-bubble-styles/stoat_valentine_day_corner_border_set.json";
import winterSolsticeStyle from "./pet-bubble-styles/stoat_winter_solstice_corner_border_set.json";

export type PetBubbleStyleId = string;
export type PetBubbleCornerId = string;
export type PetBubbleStyleLabelKey =
	| "settings.bubble.styles.plain.label"
	| "settings.bubble.styles.springFestival.label"
	| "settings.bubble.styles.dragonBoat.label"
	| "settings.bubble.styles.midAutumn.label"
	| "settings.bubble.styles.qingming.label"
	| "settings.bubble.styles.winterSolstice.label"
	| "settings.bubble.styles.aprilFools.label"
	| "settings.bubble.styles.childrenDay.label"
	| "settings.bubble.styles.christmas.label"
	| "settings.bubble.styles.halloween.label"
	| "settings.bubble.styles.laborDay.label"
	| "settings.bubble.styles.nationalDay.label"
	| "settings.bubble.styles.songkran.label"
	| "settings.bubble.styles.valentineDay.label";
export type PetBubbleStyleDescriptionKey =
	| "settings.bubble.styles.plain.description"
	| "settings.bubble.styles.springFestival.description"
	| "settings.bubble.styles.dragonBoat.description"
	| "settings.bubble.styles.midAutumn.description"
	| "settings.bubble.styles.qingming.description"
	| "settings.bubble.styles.winterSolstice.description"
	| "settings.bubble.styles.aprilFools.description"
	| "settings.bubble.styles.childrenDay.description"
	| "settings.bubble.styles.christmas.description"
	| "settings.bubble.styles.halloween.description"
	| "settings.bubble.styles.laborDay.description"
	| "settings.bubble.styles.nationalDay.description"
	| "settings.bubble.styles.songkran.description"
	| "settings.bubble.styles.valentineDay.description";

export interface PetBubbleCornerStyle {
	readonly id: PetBubbleCornerId;
	readonly backgroundPosition: string;
	readonly position: {
		readonly bottom?: string;
		readonly left?: string;
		readonly right?: string;
		readonly top?: string;
	};
}

export interface PetBubbleDecorStyle {
	readonly fileName: string;
	readonly cornerWidth: string;
	readonly cornerHeight: string;
	readonly backgroundSize: string;
	readonly corners: readonly PetBubbleCornerStyle[];
}

export interface PetBubbleSurfaceStyle {
	readonly bodyClassName: string;
	readonly textClassName: string;
	readonly style?: Readonly<Record<string, string>>;
}

export interface PetBubbleStyle {
	readonly id: PetBubbleStyleId;
	readonly labelKey: PetBubbleStyleLabelKey;
	readonly descriptionKey: PetBubbleStyleDescriptionKey;
	readonly surface: PetBubbleSurfaceStyle;
	readonly decor?: PetBubbleDecorStyle;
}

export const DEFAULT_PET_BUBBLE_STYLE_ID: PetBubbleStyleId = "plain";

function definePetBubbleStyle(style: unknown): PetBubbleStyle {
	return style as PetBubbleStyle;
}

export const PET_BUBBLE_STYLES: readonly PetBubbleStyle[] = [
	definePetBubbleStyle(plainStyle),
	definePetBubbleStyle(springFestivalStyle),
	definePetBubbleStyle(dragonBoatStyle),
	definePetBubbleStyle(midAutumnStyle),
	definePetBubbleStyle(qingmingStyle),
	definePetBubbleStyle(winterSolsticeStyle),
	definePetBubbleStyle(aprilFoolsStyle),
	definePetBubbleStyle(childrenDayStyle),
	definePetBubbleStyle(christmasStyle),
	definePetBubbleStyle(halloweenStyle),
	definePetBubbleStyle(laborDayStyle),
	definePetBubbleStyle(nationalDayStyle),
	definePetBubbleStyle(songkranStyle),
	definePetBubbleStyle(valentineDayStyle),
] as const;

const PET_BUBBLE_STYLE_IDS = new Set<string>(PET_BUBBLE_STYLES.map((style) => style.id));
const LEGACY_PET_BUBBLE_STYLE_ID_ALIASES: Readonly<Record<string, PetBubbleStyleId>> = {
	"spring-festival": "stoat_spring_festival_corner_border_set",
	"dragon-boat": "stoat_dragon_boat_festival_corner_border_set",
	"mid-autumn": "stoat_mid_autumn_festival_corner_border_set",
	qingming: "stoat_qingming_festival_corner_border_set",
	"winter-solstice": "stoat_winter_solstice_corner_border_set",
	"april-fools": "stoat_april_fools_day_corner_border_set",
	"children-day": "stoat_children_day_corner_border_set",
	christmas: "stoat_christmas_corner_border_set",
	halloween: "stoat_halloween_corner_border_set",
	"labor-day": "stoat_labor_day_corner_border_set",
	"national-day": "stoat_national_day_frame_border",
	songkran: "stoat_songkran_festival_corner_border_set",
	"valentine-day": "stoat_valentine_day_corner_border_set",
};

export function isPetBubbleStyleId(value: unknown): value is PetBubbleStyleId {
	return typeof value === "string" && PET_BUBBLE_STYLE_IDS.has(value);
}

export function normalizePetBubbleStyleId(value: unknown): PetBubbleStyleId {
	if (isPetBubbleStyleId(value)) return value;
	if (typeof value === "string") return LEGACY_PET_BUBBLE_STYLE_ID_ALIASES[value] ?? DEFAULT_PET_BUBBLE_STYLE_ID;
	return DEFAULT_PET_BUBBLE_STYLE_ID;
}

export function getPetBubbleStyle(id: PetBubbleStyleId): PetBubbleStyle {
	return PET_BUBBLE_STYLES.find((style) => style.id === id) ?? PET_BUBBLE_STYLES[0];
}

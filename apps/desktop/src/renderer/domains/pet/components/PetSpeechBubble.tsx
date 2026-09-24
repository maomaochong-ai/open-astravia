import type { CSSProperties } from "react";
import type { PetBubbleStyleId } from "../../../../shared/pet-bubbles";
import { PetBubbleFrame } from "../../../shared/components/pet/PetBubbleFrame";

const PET_BUBBLE_VISUAL_INSET_PX = 40;
const PET_BUBBLE_SURFACE_MAX_WIDTH_PX = 360;
const PET_BUBBLE_VISUAL_BOUNDS_STYLE = {
	boxSizing: "border-box",
	maxWidth: `${PET_BUBBLE_SURFACE_MAX_WIDTH_PX + PET_BUBBLE_VISUAL_INSET_PX * 2}px`,
	padding: `${PET_BUBBLE_VISUAL_INSET_PX}px`,
	width: "max-content",
} satisfies CSSProperties;

export interface PetSpeechBubbleMessage {
	text: string;
}

export function PetSpeechBubble({
	decorUrl,
	message,
	styleId,
}: {
	decorUrl: string | undefined;
	message: PetSpeechBubbleMessage | undefined;
	styleId: PetBubbleStyleId;
}): JSX.Element | null {
	if (!message) return null;

	return (
		<div
			className="pointer-events-none z-10 select-none"
			style={PET_BUBBLE_VISUAL_BOUNDS_STYLE}
		>
			<PetBubbleFrame
				decorUrl={decorUrl}
				styleId={styleId}
			>
				{message.text}
			</PetBubbleFrame>
		</div>
	);
}

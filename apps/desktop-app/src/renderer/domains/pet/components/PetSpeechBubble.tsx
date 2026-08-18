import type { PetBubbleStyleId } from "../../../../shared/pet-bubbles";
import { PetBubbleFrame } from "../../../shared/components/pet/PetBubbleFrame";

export interface PetSpeechBubbleMessage {
	text: string;
}

export function PetSpeechBubble({
	anchorSize,
	decorUrl,
	horizontalOffset,
	message,
	placement,
	styleId,
}: {
	anchorSize: number;
	decorUrl: string | undefined;
	horizontalOffset: number;
	message: PetSpeechBubbleMessage | undefined;
	placement: "above" | "below";
	styleId: PetBubbleStyleId;
}): JSX.Element | null {
	if (!message) return null;

	return (
		<div
			className="pointer-events-none absolute z-10 max-w-[min(360px,calc(100vw-24px))] -translate-x-1/2 select-none"
			style={
				placement === "above"
					? { bottom: `calc(50% + ${anchorSize / 2}px)`, left: `calc(50% + ${horizontalOffset}px)` }
					: { top: `calc(50% + ${anchorSize / 2}px)`, left: `calc(50% + ${horizontalOffset}px)` }
			}
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

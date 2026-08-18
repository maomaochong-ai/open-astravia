import type { CSSProperties, ReactNode } from "react";
import { CornerImageFrame } from "@vetta/theme-ui/appearance";
import { getPetBubbleStyle, type PetBubbleStyleId } from "../../../../shared/pet-bubbles";

export function PetBubbleFrame({
	children,
	decorUrl,
	styleId,
}: {
	children: ReactNode;
	decorUrl: string | undefined;
	styleId: PetBubbleStyleId;
}): JSX.Element {
	const bubbleStyle = getPetBubbleStyle(styleId);
	const decor = bubbleStyle.decor;
	const surfaceStyle = bubbleStyle.surface.style as CSSProperties | undefined;

	return (
		<CornerImageFrame
			className={bubbleStyle.surface.bodyClassName}
			contentClassName={bubbleStyle.surface.textClassName}
			decoration={decor}
			imageUrl={decorUrl}
			style={surfaceStyle}
		>
			{children}
		</CornerImageFrame>
	);
}

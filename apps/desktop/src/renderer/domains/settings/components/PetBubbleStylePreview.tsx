import { PetBubbleFrame } from "@shared/components/pet/PetBubbleFrame";
import { PetBubbleStylePreviewView } from "@vetta/theme-ui/settings";
import type { PetBubbleStyleId } from "../../../../shared/pet-bubbles";

export function PetBubbleStylePreview({
	decorUrl,
	description,
	disabled,
	label,
	onSelect,
	selected,
	styleId,
}: {
	decorUrl: string | undefined;
	description: string;
	disabled: boolean;
	label: string;
	onSelect: (styleId: PetBubbleStyleId) => void;
	selected: boolean;
	styleId: PetBubbleStyleId;
}): JSX.Element {
	return (
		<PetBubbleStylePreviewView
			description={description}
			disabled={disabled}
			label={label}
			onSelect={() => onSelect(styleId)}
			selected={selected}
			preview={<PetBubbleFrame decorUrl={decorUrl} styleId={styleId}>{label}</PetBubbleFrame>}
		/>
	);
}

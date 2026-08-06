import { Button } from "@vetta/ui";
import type { JSX } from "react";

interface ToolbarButtonProps {
	label: string;
	onClick: () => void;
	disabled?: boolean;
}

export function ToolbarButton({ label, onClick, disabled }: ToolbarButtonProps): JSX.Element {
	return (
		<Button type="button" variant="ghost" size="xs" onClick={onClick} disabled={disabled}>
			{label}
		</Button>
	);
}

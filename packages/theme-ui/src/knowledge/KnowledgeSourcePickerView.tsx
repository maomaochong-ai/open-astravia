import { useState, type JSX } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@vetta-org/ui";

export interface KnowledgeSourcePickerViewLabels {
	readonly addMaterials: string;
	readonly pickFiles: string;
	readonly pickFolders: string;
}

export interface KnowledgeSourcePickerViewProps {
	readonly onPickFiles: () => void;
	readonly onPickFolders: () => void;
	readonly size?: "sm";
	readonly labels: KnowledgeSourcePickerViewLabels;
}

export function KnowledgeSourcePickerView({
	onPickFiles,
	onPickFolders,
	size,
	labels,
}: KnowledgeSourcePickerViewProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const runAndClose = (action: () => void) => {
		setOpen(false);
		action();
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size={size}>
					<span className="icon-[mdi--file-plus-outline] h-4 w-4" />
					{labels.addMaterials}
					<span className="icon-[mdi--chevron-down] h-3.5 w-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-44 gap-1 p-1">
				<Button
					type="button"
					variant="ghost"
					onClick={() => runAndClose(onPickFiles)}
					className="h-8 w-full justify-start px-2.5 text-[12px] text-foreground"
				>
					<span className="icon-[mdi--file-multiple-outline] h-4 w-4 text-muted-foreground" />
					{labels.pickFiles}
				</Button>
				<Button
					type="button"
					variant="ghost"
					onClick={() => runAndClose(onPickFolders)}
					className="h-8 w-full justify-start px-2.5 text-[12px] text-foreground"
				>
					<span className="icon-[mdi--folder-multiple-outline] h-4 w-4 text-muted-foreground" />
					{labels.pickFolders}
				</Button>
			</PopoverContent>
		</Popover>
	);
}

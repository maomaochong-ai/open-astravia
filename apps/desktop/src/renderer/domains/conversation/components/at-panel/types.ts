import type { AtPanelClassNames } from "@vetta/theme-ui/chat";

export type {
	AtPanelClassNames,
	AtPanelEntryModel,
	AtPanelLabels,
	AtPanelViewProps,
} from "@vetta/theme-ui/chat";

/** A caller supplied candidate shown alongside file results in the shared @ panel. */
export interface AtPanelItem {
	readonly kind: string;
	readonly id: string;
	readonly name: string;
	/** Text inserted by the caller when this item is selected (for example `@research`). */
	readonly insertText: string;
	readonly avatar?: string;
	readonly icon?: string;
	readonly meta?: string;
	readonly keywords?: readonly string[];
}

export interface SelectedFile {
	path: string;
	name: string;
	isDirectory: boolean;
}

export type AtPanelSelection = SelectedFile | AtPanelItem;

export interface AtPanelProps {
	open: boolean;
	onClose: () => void;
	onSelect: (selection: AtPanelSelection) => void;
	filter: string;
	cwd: string;
	/** Additional candidates supplied by a connector; ordinary chat leaves this empty. */
	items?: readonly AtPanelItem[];
	className?: string;
	classNames?: AtPanelClassNames;
}

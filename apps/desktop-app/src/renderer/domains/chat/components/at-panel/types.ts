import type { AtPanelClassNames } from "@vetta/theme-ui/chat";

export type {
	AtPanelClassNames,
	AtPanelEntryModel,
	AtPanelLabels,
	AtPanelViewProps,
} from "@vetta/theme-ui/chat";

export interface SelectedFile {
	path: string;
	name: string;
	isDirectory: boolean;
}

export interface AtPanelProps {
	open: boolean;
	onClose: () => void;
	onSelect: (file: SelectedFile) => void;
	filter: string;
	cwd: string;
	className?: string;
	classNames?: AtPanelClassNames;
}

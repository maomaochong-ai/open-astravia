import type { AtPanelClassNames } from "@astravia/theme-ui/chat";

export type {
	AtPanelClassNames,
	AtPanelEntryModel,
	AtPanelLabels,
	AtPanelViewProps,
} from "@astravia/theme-ui/chat";

/** 文件系统选择结果（mode=files） */
export interface SelectedFile {
	path: string;
	name: string;
	isDirectory: boolean;
}

/** 数据库连接选择结果（mode=database，选了连接本身） */
export interface SelectedDbConnection {
	kind: "database-connection";
	connection: string;
	env?: "dev" | "prod";
}

/** 数据库表选择结果（mode=database，选了表） */
export interface SelectedDbTable {
	kind: "database-table";
	connection: string;
	table: string;
	/** 非 flat 类型的 catalog 作用域（PG schema / MySQL database） */
	scope?: { kind: "schema" | "database"; name: string };
	env?: "dev" | "prod";
}

/** AtPanel 统一选择结果 */
export type AtPanelSelection = SelectedFile | SelectedDbConnection | SelectedDbTable;

export interface AtPanelProps {
	open: boolean;
	onClose: () => void;
	onSelect: (selection: AtPanelSelection) => void;
	filter: string;
	cwd: string;
	className?: string;
	classNames?: AtPanelClassNames;
}

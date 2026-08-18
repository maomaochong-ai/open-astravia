import { FilesPanelView } from "@vetta/theme-ui/file-explorer";
import { useFilesPanelModel } from "../hooks/useFilesPanelModel";

interface FilesPanelProps {
	/** 显式根目录（项目详情页等无 active session 场景使用） */
	cwd?: string | null;
}

export function FilesPanel({ cwd }: FilesPanelProps = {}): JSX.Element {
	const model = useFilesPanelModel(cwd);
	return <FilesPanelView {...model} />;
}

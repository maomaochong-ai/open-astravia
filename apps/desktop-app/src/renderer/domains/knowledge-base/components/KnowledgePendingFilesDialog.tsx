import { useTranslation } from "react-i18next";
import { KnowledgePendingFilesDialogView } from "@vetta/theme-ui/knowledge";
import type { UnprocessedFile } from "../lib/knowledge-base";

interface KnowledgePendingFilesDialogProps {
	/** 当前库显示名，根目录文件的目录标签回退到它。 */
	baseName: string;
	files: UnprocessedFile[];
	/** 点击某项：跳到其所在目录并高亮。 */
	onPick: (fileId: string) => void;
	onClose: () => void;
}

/** 待加工（未加工）文件平铺清单：图标 + 文件名 + 灰字相对目录；点击跳转到对应目录。 */
export function KnowledgePendingFilesDialog({
	baseName,
	files,
	onPick,
	onClose,
}: KnowledgePendingFilesDialogProps): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<KnowledgePendingFilesDialogView
			baseName={baseName}
			files={files}
			onPick={onPick}
			onClose={onClose}
			labels={{
				title: t("kbPendingTitle", { n: files.length }),
				empty: t("kbPendingEmpty"),
			}}
		/>
	);
}

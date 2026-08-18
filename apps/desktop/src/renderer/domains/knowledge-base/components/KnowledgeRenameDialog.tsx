import { useTranslation } from "react-i18next";
import { KnowledgeRenameDialogView } from "@vetta/theme-ui/knowledge";

interface KnowledgeRenameDialogProps {
	title: string;
	initialName: string;
	onClose: () => void;
	onSubmit: (newName: string) => void;
}

/** 通用重命名对话框：用于知识库 / 库内文件目录改名。 */
export function KnowledgeRenameDialog({
	title,
	initialName,
	onClose,
	onSubmit,
}: KnowledgeRenameDialogProps): JSX.Element {
	const { t } = useTranslation("common");

	return (
		<KnowledgeRenameDialogView
			title={title}
			initialName={initialName}
			onClose={onClose}
			onSubmit={onSubmit}
			labels={{
				cancel: t("actions.cancel"),
				confirm: t("actions.confirm"),
			}}
		/>
	);
}

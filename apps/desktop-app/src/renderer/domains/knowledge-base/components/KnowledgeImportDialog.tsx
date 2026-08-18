import { useTranslation } from "react-i18next";
import type { KnowledgeBase, KnowledgeImportDraft } from "@shared/types/knowledge-base";
import {
	KnowledgeImportDialogView,
	KNOWLEDGE_IMPORT_NEW_BASE,
} from "@vetta/theme-ui/knowledge";
import { knowledgeBaseDisplayName } from "../lib/knowledge-base";

export interface KnowledgeImportConfirmation {
	/** 选中已有库则为其 id；新建库则 null（用 name 创建）。 */
	targetId: string | null;
	name: string;
	sourcePaths: string[];
}

interface KnowledgeImportDialogProps {
	draft: KnowledgeImportDraft;
	activeKnowledgeBaseId: string | null;
	knowledgeBases: KnowledgeBase[];
	onClose: () => void;
	onConfirm: (confirmation: KnowledgeImportConfirmation) => void;
}

export function KnowledgeImportDialog({
	draft,
	activeKnowledgeBaseId,
	knowledgeBases,
	onClose,
	onConfirm,
}: KnowledgeImportDialogProps): JSX.Element {
	const { t } = useTranslation(["settings", "common"]);
	const createOnly = draft.createOnly ?? false;
	const initialTarget = createOnly
		? KNOWLEDGE_IMPORT_NEW_BASE
		: (draft.defaultTargetId ?? activeKnowledgeBaseId ?? knowledgeBases[0]?.id ?? KNOWLEDGE_IMPORT_NEW_BASE);

	return (
		<KnowledgeImportDialogView
			createOnly={createOnly}
			sourcePaths={draft.sourcePaths}
			knowledgeBases={knowledgeBases.map((base) => ({
				id: base.id,
				name: knowledgeBaseDisplayName(base),
			}))}
			initialTargetId={initialTarget}
			onClose={onClose}
			onConfirm={onConfirm}
			labels={{
				createTitle: t("kbImportCreateTitle"),
				addTitle: t("kbImportAddTitle"),
				createDesc: t("kbImportCreateDesc"),
				addDesc: t("kbImportAddDesc", { n: draft.sourcePaths.length }),
				addTo: t("kbImportAddTo"),
				createBase: t("kbCreateBase"),
				nameLabel: t("kbImportNameLabel"),
				cancel: t("common:actions.cancel"),
				createBtn: t("kbImportCreateBtn"),
				startBtn: t("kbImportStartBtn"),
				newBaseName: t("kbImportNewBaseName"),
			}}
		/>
	);
}

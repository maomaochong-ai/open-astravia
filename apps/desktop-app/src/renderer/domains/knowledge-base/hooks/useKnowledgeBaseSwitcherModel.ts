import { knowledgeFileStatusesAtom } from "@shared/store/atoms";
import type { KnowledgeBase } from "@shared/types/knowledge-base";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { countKnowledgeFilesFromStatuses, knowledgeBaseDisplayName } from "../lib/knowledge-base";

const QUICK_LIST_LIMIT = 6;

export interface KnowledgeBaseSwitcherItemView {
	readonly active: boolean;
	readonly fileCountLabel: string;
	readonly id: string;
	readonly isDefault: boolean;
	readonly name: string;
}

export interface KnowledgeBaseSwitcherModel {
	readonly activeName: string;
	readonly basesCount: number;
	readonly items: readonly KnowledgeBaseSwitcherItemView[];
	readonly labels: {
		readonly createBase: string;
		readonly deleteCurrent: string;
		readonly renameBaseTitle: string;
		readonly renameCurrent: string;
		readonly switchLabel: string;
		readonly viewAll: string;
	};
	readonly onClose: () => void;
	readonly onConfirmDelete: () => void;
	readonly onCreate: () => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly onRenameSubmit: (newName: string) => void;
	readonly onSelect: (id: string) => void;
	readonly onStartRename: () => void;
	readonly onViewAll: () => void;
	readonly open: boolean;
	readonly renaming: boolean;
	readonly setRenaming: (value: boolean) => void;
	readonly showManageCurrent: boolean;
}

export function useKnowledgeBaseSwitcherModel({
	bases,
	activeBase,
	onSelect,
	onCreate,
	onViewAll,
	onRenameBase,
	onRequestDeleteBase,
}: {
	bases: KnowledgeBase[];
	activeBase: KnowledgeBase;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onViewAll: () => void;
	onRenameBase: (newName: string) => void;
	onRequestDeleteBase: () => void;
}): KnowledgeBaseSwitcherModel {
	const { t } = useTranslation("settings");
	const fileStatuses = useAtomValue(knowledgeFileStatusesAtom);
	const [open, setOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const activeName = knowledgeBaseDisplayName(activeBase);

	const quickBases = [
		activeBase,
		...bases.filter((base) => base.id !== activeBase.id).sort((a, b) => b.updatedAt - a.updatedAt),
	].slice(0, QUICK_LIST_LIMIT);

	return useMemo(
		() => ({
			activeName,
			basesCount: bases.length,
			items: quickBases.map((base) => ({
				active: base.id === activeBase.id,
				fileCountLabel: t("kbFileCount", {
					n: countKnowledgeFilesFromStatuses(base.id, fileStatuses),
				}),
				id: base.id,
				isDefault: base.isDefault,
				name: knowledgeBaseDisplayName(base),
			})),
			labels: {
				createBase: t("kbCreateBase"),
				deleteCurrent: t("kbDeleteCurrent"),
				renameBaseTitle: t("kbRenameBaseTitle"),
				renameCurrent: t("kbRenameCurrent"),
				switchLabel: t("kbSwitchLabel"),
				viewAll: t("kbViewAll"),
			},
			onClose: () => setOpen(false),
			onConfirmDelete: () => {
				setOpen(false);
				onRequestDeleteBase();
			},
			onCreate: () => {
				onCreate();
				setOpen(false);
			},
			onOpenChange: setOpen,
			onRenameSubmit: (newName: string) => {
				setRenaming(false);
				onRenameBase(newName);
			},
			onSelect: (id: string) => {
				onSelect(id);
				setOpen(false);
			},
			onStartRename: () => {
				setOpen(false);
				setRenaming(true);
			},
			onViewAll: () => {
				onViewAll();
				setOpen(false);
			},
			open,
			renaming,
			setRenaming,
			showManageCurrent: !activeBase.isDefault,
		}),
		[
			activeBase.id,
			activeBase.isDefault,
			activeName,
			bases.length,
			fileStatuses,
			onCreate,
			onRenameBase,
			onRequestDeleteBase,
			onSelect,
			onViewAll,
			open,
			quickBases,
			renaming,
			t,
		],
	);
}

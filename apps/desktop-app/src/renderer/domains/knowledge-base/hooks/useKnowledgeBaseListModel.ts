import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import {
	activeKnowledgeBaseIdAtom,
	knowledgeBasesAtom,
	knowledgeFileStatusesAtom,
	knowledgeImportDraftAtom,
	refreshKnowledgeBasesAtom,
} from "@shared/store/atoms";
import type { KnowledgeBase } from "@shared/types/knowledge-base";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { knowledgeBaseDisplayName } from "../lib/knowledge-base";

export function useKnowledgeBaseListModel() {
	const knowledgeBases = useAtomValue(knowledgeBasesAtom);
	const activeId = useAtomValue(activeKnowledgeBaseIdAtom);
	const setActiveId = useSetAtom(activeKnowledgeBaseIdAtom);
	const setDraft = useSetAtom(knowledgeImportDraftAtom);
	const refresh = useSetAtom(refreshKnowledgeBasesAtom);
	const fileStatuses = useAtomValue(knowledgeFileStatusesAtom);
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const narrow = useNarrowScreen();

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const filteredBases = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		return [...knowledgeBases]
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.filter((base) => {
				if (!query) return true;
				return knowledgeBaseDisplayName(base).toLocaleLowerCase().includes(query);
			});
	}, [knowledgeBases, search]);

	const openKnowledgeBase = (base: KnowledgeBase) => {
		setActiveId(base.id);
		void navigate({ to: "/knowledge" });
	};

	const createKnowledgeBase = () => {
		setDraft({ sourcePaths: [], defaultTargetId: null, createOnly: true });
		void navigate({ to: "/knowledge" });
	};

	const goBack = () => {
		void navigate({ to: "/knowledge" });
	};

	return {
		activeId,
		createKnowledgeBase,
		fileStatuses,
		filteredBases,
		goBack,
		knowledgeBases,
		narrow,
		openKnowledgeBase,
		search,
		setSearch,
	};
}

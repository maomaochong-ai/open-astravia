import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface KnowledgeProcessingBadgeModel {
	processing: boolean;
	label: string;
}

export function useKnowledgeProcessingBadgeModel(): KnowledgeProcessingBadgeModel {
	const { t } = useTranslation("settings");
	const [processing, setProcessing] = useState(false);

	useEffect(() => {
		let alive = true;
		void window.vetta.knowledge.isProcessing().then((v) => {
			if (alive) setProcessing(v);
		});
		const off = window.vetta.knowledge.onProcessingChanged((v) => setProcessing(v));
		return () => {
			alive = false;
			off();
		};
	}, []);

	return {
		processing,
		label: t("kbIndexing"),
	};
}

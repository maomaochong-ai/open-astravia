import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSetAtom } from "jotai";
import { useOwnedHeaderTitleHidden } from "@shared/hooks/useOwnedHeaderTitleHidden";
import {
	pageHeaderRightSlotAtom,
	pageHeaderTitleBadgeAtom,
} from "@shared/store/atoms";
import { useSurfaceActive } from "@shared/surface-active";
import { Button } from "@shared/components/ui/button";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { useKnowledgeBasePageModel } from "../hooks/useKnowledgeBasePageModel";
import { KnowledgeBasePageView } from "./KnowledgeBasePageView";
import { KnowledgeProcessingBadge } from "./KnowledgeProcessingBadge";

export function KnowledgeBasePage(): JSX.Element {
	const { t } = useTranslation("settings");
	const model = useKnowledgeBasePageModel();
	const setTitleBadge = useSetAtom(pageHeaderTitleBadgeAtom);
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const surfaceActive = useSurfaceActive();
	useOwnedHeaderTitleHidden(surfaceActive);

	useEffect(() => {
		if (!surfaceActive) return;
		setTitleBadge(<KnowledgeProcessingBadge />);
		return () => setTitleBadge(null);
	}, [setTitleBadge, surfaceActive]);

	useEffect(() => {
		if (!surfaceActive) return;
		setHeaderRightSlot(
			<>
				<SettingsAiAssist tabId="knowledgeBase" />
				{model.activeBase && (
					<Button variant="ghost" size="sm" onClick={() => model.setPendingOpen(true)}>
						<span className="icon-[mdi--clock-alert-outline] h-4 w-4" />
						{t("kbPendingEntry")}
						{model.pendingCount > 0 && (
							<span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold tabular-nums text-primary">
								{model.pendingCount}
							</span>
						)}
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={model.openProcessingRecords}>
					<span className="icon-[mdi--history] h-4 w-4" />
					{t("kbPageRecords")}
				</Button>
				<Button variant="ghost" size="sm" onClick={model.openKnowledgeSettings}>
					<span className="icon-[mdi--cog-outline] h-4 w-4" />
					{t("kbPageSettings")}
				</Button>
			</>,
		);
		return () => setHeaderRightSlot(null);
	}, [
		model.activeBase,
		model.openKnowledgeSettings,
		model.openProcessingRecords,
		model.pendingCount,
		model.setPendingOpen,
		setHeaderRightSlot,
		surfaceActive,
		t,
	]);

	return <KnowledgeBasePageView model={model} />;
}

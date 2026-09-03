import { ActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import { SessionViewerPageView } from "@vetta/theme-ui/chat";
import { useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSessionViewerPageModel } from "../hooks/useSessionViewerPageModel";
import { ChatExportHost } from "./ChatExportHost";
import { MessageList } from "./MessageList";

/**
 * Read-only viewer for sessions the desktop app does not own (currently
 * IM sessions written by im-gateway).
 */
export function SessionViewerPage(): JSX.Element {
	const { t } = useTranslation("chat");
	const surface = useThemeSurface("chat.sessionViewerPage");
	const model = useSessionViewerPageModel();
	const setHeaderRight = useSetAtom(pageHeaderRightSlotAtom);
	const header = useMemo(
		() => (
			<div className="flex items-center gap-2 text-[12px] text-muted-foreground">
				<span className="hidden truncate sm:inline">{t("sessionViewer.header.subtitle")}</span>
				<span
					className={
						model.isIm
							? "rounded bg-primary/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-primary"
							: "rounded bg-muted/60 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
					}
				>
					{model.isIm ? t("sessionViewer.badge.liveUpdate") : t("sessionViewer.badge.readOnly")}
				</span>
				<Button
					size="icon-xs"
					variant="ghost"
					title={t("sessionViewer.exportButton.title")}
					disabled={model.messages.length === 0 || model.exporting}
					onClick={model.onStartExport}
				>
					<span
						className={
							model.exporting
								? "icon-[mdi--loading] animate-spin text-[14px]"
								: "icon-[mdi--language-html5] text-[14px]"
						}
					/>
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					title={
						model.panelOpen
							? t("sessionViewer.panelToggleButton.titleClose")
							: t("sessionViewer.panelToggleButton.titleOpen")
					}
					onClick={model.onTogglePanel}
					className={model.panelOpen ? "bg-accent text-foreground" : ""}
				>
					<span className="icon-[solar--sidebar-minimalistic-linear] -scale-x-100 text-[14px]" />
				</Button>
			</div>
		),
		[
			model.exporting,
			model.isIm,
			model.messages.length,
			model.onStartExport,
			model.onTogglePanel,
			model.panelOpen,
			t,
		],
	);

	useEffect(() => {
		setHeaderRight(header);
		return () => setHeaderRight(null);
	}, [header, setHeaderRight]);

	return (
		<SessionViewerPageView
			rootClassName={cn("flex h-full min-w-0 flex-1 flex-col bg-background", surface?.rootClassName)}
			emptyPathLabel={model.emptyPathLabel}
			error={model.error}
			errorPrefix={model.errorPrefix}
			hasPath={Boolean(model.path)}
			exportHost={
				model.exporting ? (
					<ChatExportHost
						messages={model.messages}
						title={model.exportTitle}
						onFinished={model.onExportFinished}
					/>
				) : null
			}
			messageList={<MessageList messages={model.messages} isStreaming={false} sessionId={null} />}
			activityPanel={
				model.isKnowledge ? (
					<ActivityPanel
						workspace={createActivityWorkspace(model.kbCwd || "knowledge:unbound", model.kbCwd || null)}
						enablePluginTabs={false}
						knowledgeHistory
					/>
				) : (
					<ActivityPanel
						workspace={createActivityWorkspace(model.imCwd || "viewer:unbound", model.imCwd || null)}
						enablePluginTabs={false}
					/>
				)
			}
		/>
	);
}

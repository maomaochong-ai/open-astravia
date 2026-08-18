import { KnowledgeFilesSkeleton } from "@vetta/theme-ui/knowledge";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { Button, cn } from "@vetta/ui";
import { KnowledgeHowItWorksDialog } from "@shared/components/KnowledgeHowItWorksDialog";
import { SettingsAiAssist } from "../../settings/ai-assist";
import type { useKnowledgeBasePageModel } from "../hooks/useKnowledgeBasePageModel";
import { knowledgeBaseDisplayName } from "../lib/knowledge-base";
import { KnowledgeBaseSwitcher } from "./KnowledgeBaseSwitcher";
import { KnowledgeContentsPanel } from "./KnowledgeContentsPanel";
import { KnowledgeImportDialog } from "./KnowledgeImportDialog";
import { KnowledgePendingFilesDialog } from "./KnowledgePendingFilesDialog";
import { KnowledgeSourcePicker } from "./KnowledgeSourcePicker";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

interface KnowledgeBasePageViewProps {
	model: ReturnType<typeof useKnowledgeBasePageModel>;
}

export function KnowledgeBasePageView({ model }: KnowledgeBasePageViewProps): JSX.Element {
	const { t } = useTranslation("settings");

	if (!model.knowledgeBaseEnabled) {
		return (
			<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
				<div className="flex flex-1 items-center justify-center px-8 py-10">
					<motion.div
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.4, ease: EASE_OUT }}
						className="flex w-full max-w-[420px] flex-col items-center text-center"
					>
						<div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
							<span className="icon-[solar--library-linear] h-8 w-8" />
						</div>
						<h1 className="mt-5 text-[20px] font-bold tracking-tight text-foreground">
							{t("kbPageDisabledTitle")}
						</h1>
						<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
							{t("kbPageDisabledDesc")}
						</p>
						<div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
							<Button variant="primary" onClick={model.enableKnowledgeBase}>
								<span className="icon-[mdi--power] h-4 w-4" />
								{t("kbPageEnable")}
							</Button>
							<Button variant="ghost" onClick={model.openKnowledgeSettings}>
								{t("kbPageGotoSettings")}
							</Button>
							<SettingsAiAssist tabId="knowledgeBase" />
						</div>
						<button
							type="button"
							onClick={() => model.setHowItWorksOpen(true)}
							className="mt-4 text-[12px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
						>
							{t("kbPageLearnHow")}
						</button>
					</motion.div>
				</div>

				<KnowledgeHowItWorksDialog
					open={model.howItWorksOpen}
					onClose={() => model.setHowItWorksOpen(false)}
				/>
			</div>
		);
	}

	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<input
				ref={model.fileInputRef}
				type="file"
				multiple
				className="hidden"
				onChange={model.onFilesPicked}
			/>

			<header
				className={cn(
					"flex shrink-0 gap-4 px-8 pb-4 pt-7",
					model.narrow ? "flex-col items-stretch" : "items-center justify-between",
				)}
			>
				<motion.div
					initial={{ opacity: 0, y: -8 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.45, ease: EASE_OUT }}
					className="min-w-0"
				>
					{model.activeBase ? (
						<KnowledgeBaseSwitcher
							bases={model.knowledgeBases}
							activeBase={model.activeBase}
							onSelect={model.setActiveId}
							onCreate={model.openCreateDialog}
							onViewAll={model.openAllKnowledgeBases}
							onRenameBase={model.renameBase}
							onRequestDeleteBase={model.requestDeleteBase}
						/>
					) : (
						<h1 className="whitespace-nowrap text-[24px] font-bold tracking-tight text-foreground">
							{t("kbPageTitle")}
						</h1>
					)}
					<p className="mt-1 text-[12px] text-muted-foreground/60">{t("kbPageSubtitle")}</p>
					<p className="mt-0.5 text-[12px] text-muted-foreground/60">
						{t("kbPageTokenNote")}
						<button
							type="button"
							onClick={() => model.setHowItWorksOpen(true)}
							className="font-medium text-primary underline-offset-2 hover:underline"
						>
							{t("kbPageViewDetail")}
						</button>
					</p>
				</motion.div>
				{model.activeBase && (
					<motion.div
						initial={{ opacity: 0, y: -6 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.4, delay: 0.06, ease: EASE_OUT }}
						className={cn(
							"flex shrink-0 items-center gap-2",
							model.narrow ? "flex-wrap justify-end" : "",
						)}
					>
						<Button variant="ghost" size="icon-sm" title={t("kbPageRefresh")} onClick={() => void model.refresh()}>
							<span className="icon-[mdi--refresh] h-4 w-4" />
						</Button>
						<div className="flex items-center rounded-lg bg-muted/55 p-0.5">
							{(
								[
									{ mode: "grid", icon: "icon-[mdi--view-grid-outline]", title: t("kbPageGridView") },
									{ mode: "list", icon: "icon-[mdi--view-list-outline]", title: t("kbPageListView") },
								] as const
							).map(({ mode, icon, title }) => (
								<button
									key={mode}
									type="button"
									title={title}
									aria-pressed={model.viewMode === mode}
									onClick={() => model.setViewMode(mode)}
									className={cn(
										"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
										model.viewMode === mode
											? "bg-background text-foreground shadow-sm"
											: "text-muted-foreground/60 hover:text-foreground",
									)}
								>
									<span className={cn(icon, "h-4 w-4")} />
								</button>
							))}
						</div>
						<KnowledgeSourcePicker
							onPickFiles={model.pickFilesForActiveBase}
							onPickFolders={model.pickFoldersForActiveBase}
						/>
						<div className="relative w-28 sm:w-40">
							<span className="icon-[mdi--magnify] absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
							<input
								value={model.search}
								onChange={(event) => model.setSearch(event.target.value)}
								placeholder={t("kbPageSearch")}
								className="h-8 w-full min-w-0 rounded-lg border border-transparent bg-secondary pl-7 pr-2.5 text-[12px] shadow-none outline-none placeholder:text-muted-foreground/45 hover:bg-accent focus-visible:border-primary/25 focus-visible:bg-background/70"
							/>
						</div>
					</motion.div>
				)}
			</header>

			{/* 仅列表尚无缓存时页面骨架；有 activeBase 时保持内容面板挂载，避免 path 丢失弹回根层 */}
			{model.showFilesSkeleton && <KnowledgeFilesSkeleton />}

			<AnimatePresence mode="popLayout" initial={false}>
				{model.activeBase && (
					<motion.div
						key={model.activeBase.id}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -4 }}
						transition={{ duration: 0.24, ease: EASE_OUT }}
						className="flex min-h-0 flex-1"
					>
						<KnowledgeContentsPanel
							knowledgeBase={model.activeBase}
							search={model.search}
							onPickFiles={model.pickFilesForActiveBase}
							onPickFolders={model.pickFoldersForActiveBase}
						/>
					</motion.div>
				)}
			</AnimatePresence>

			{model.draft && (
				<KnowledgeImportDialog
					draft={model.draft}
					activeKnowledgeBaseId={model.activeBase?.id ?? null}
					knowledgeBases={model.knowledgeBases}
					onClose={() => model.setDraft(null)}
					onConfirm={model.confirmImport}
				/>
			)}

			<KnowledgeHowItWorksDialog
				open={model.howItWorksOpen}
				onClose={() => model.setHowItWorksOpen(false)}
			/>

			{model.pendingOpen && model.activeBase && (
				<KnowledgePendingFilesDialog
					baseName={knowledgeBaseDisplayName(model.activeBase)}
					files={model.pendingFiles}
					onPick={model.handlePickPending}
					onClose={() => model.setPendingOpen(false)}
				/>
			)}
		</div>
	);
}

export type ThemeUiLink_KnowledgeFilesSkeleton = typeof KnowledgeFilesSkeleton;

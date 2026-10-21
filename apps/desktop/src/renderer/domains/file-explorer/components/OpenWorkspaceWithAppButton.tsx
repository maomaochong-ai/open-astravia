import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@astravia-org/ui";
import type { ExternalApplication, ExternalApplicationKind } from "@preload/api-types/system";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@shared/store/toast-atoms";

interface OpenWorkspaceWithAppProps {
	/** 要打开的工作区目录；null = 会话还没绑定工作区，此时只启动应用。 */
	rootDir: string | null;
}

const STORAGE_KEY = "astravia:open-workspace:app-id";

/** 分类图标：让一屏条目在扫视时先认出「这是编辑器还是终端」。 */
const KIND_ICON: Record<ExternalApplicationKind, string> = {
	editor: "icon-[solar--code-square-linear]",
	"file-manager": "icon-[solar--folder-linear]",
	terminal: "icon-[solar--command-linear]",
	other: "icon-[solar--widget-2-linear]",
};

/**
 * 顶栏的「在外部应用中打开工作区」按钮。
 *
 * 常驻显示：菜单里列出本机探测到的代码编辑器、文件管理器与终端（VS Code、Cursor、
 * Trae、Sublime、iTerm 等），点谁就用谁打开当前工作区目录。会话还没绑定工作区时
 * 仍然列出这份清单，选中即直接启动该应用。
 */
export function OpenWorkspaceWithAppButton({ rootDir }: OpenWorkspaceWithAppProps): JSX.Element {
	const { t } = useTranslation("chat");
	const [applications, setApplications] = useState<ExternalApplication[]>([]);
	const [loading, setLoading] = useState(true);
	const [lastAppId, setLastAppId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

	const loadApplications = useCallback(async () => {
		setLoading(true);
		try {
			const apps = await window.astravia.shell.listExternalApplications(rootDir);
			setApplications(apps);
		} catch {
			setApplications([]);
		} finally {
			setLoading(false);
		}
	}, [rootDir]);

	useEffect(() => {
		void loadApplications();
	}, [loadApplications]);

	const fail = useCallback(
		(error: unknown) => {
			console.error("Failed to open workspace with application", error);
			showToast({ variant: "error", message: t("fileExplorer.openWorkspaceWithAppFailed") });
		},
		[t],
	);

	const handleOpen = useCallback(
		async (app: ExternalApplication) => {
			try {
				await window.astravia.shell.openPathWithApplication(rootDir, app.id, app.kind);
				localStorage.setItem(STORAGE_KEY, app.id);
				setLastAppId(app.id);
			} catch (error: unknown) {
				fail(error);
			}
		},
		[fail, rootDir],
	);

	const handleOpenDefault = useCallback(async () => {
		if (rootDir === null) return;
		try {
			await window.astravia.shell.openPathWithDefaultApplication(rootDir);
		} catch (error: unknown) {
			fail(error);
		}
	}, [fail, rootDir]);

	// 上次用过的应用提到最前，其余保持主进程给的顺序（编辑器 → 文件管理器 → 终端）。
	const sorted = useMemo(() => {
		if (lastAppId === null) return applications;
		const index = applications.findIndex((app) => app.id === lastAppId);
		if (index <= 0) return applications;
		const next = applications.slice();
		const [lastUsed] = next.splice(index, 1);
		next.unshift(lastUsed);
		return next;
	}, [applications, lastAppId]);

	const title = rootDir === null ? t("fileExplorer.openWorkspaceWithAppNoWorkspace") : t("fileExplorer.openWorkspaceWithApp");

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-xs" title={title} aria-label={title} onClick={() => void loadApplications()}>
					<span className="icon-[solar--export-linear] h-3.5 w-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-[min(70vh,420px)] min-w-[220px] overflow-y-auto">
				{loading ? (
					<DropdownMenuItem disabled>{t("fileExplorer.loadingApplications")}</DropdownMenuItem>
				) : sorted.length === 0 ? (
					<DropdownMenuItem disabled>{t("fileExplorer.noApplications")}</DropdownMenuItem>
				) : (
					sorted.map((app) => (
						<DropdownMenuItem key={app.id} onSelect={() => void handleOpen(app)}>
							<span className="flex w-full items-center gap-2">
								<span className={`${KIND_ICON[app.kind]} h-3.5 w-3.5 shrink-0 text-muted-foreground`} />
								<span className="truncate">{app.name}</span>
								{app.id === lastAppId && (
									<span className="icon-[solar--check-circle-linear] ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
								)}
								{app.isDefault && app.id !== lastAppId && (
									<span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
										{t("fileExplorer.defaultApp")}
									</span>
								)}
							</span>
						</DropdownMenuItem>
					))
				)}
				{rootDir !== null && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => void handleOpenDefault()}>
							<span className="flex w-full items-center gap-2">
								<span className="icon-[solar--folder-open-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span className="truncate">{t("fileExplorer.openWithDefaultApp")}</span>
							</span>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

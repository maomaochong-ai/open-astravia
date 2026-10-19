import { useCallback, useEffect, useState } from "react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@astravia-org/ui";
import { useTranslation } from "react-i18next";
import type { ExternalApplication } from "@preload/api-types/system";

interface OpenWorkspaceWithAppProps {
	rootDir: string;
}

const STORAGE_KEY = "astravia:open-workspace:app-id";

/**
 * 文件树工具栏上的「在外部应用中打开工作区」按钮。
 * 点击列出可打开当前工作区目录的外部应用，选择后调起对应应用。
 */
export function OpenWorkspaceWithAppButton({ rootDir }: OpenWorkspaceWithAppProps): JSX.Element {
	const { t } = useTranslation("chat");
	const [applications, setApplications] = useState<ExternalApplication[]>([]);
	const [loading, setLoading] = useState(false);
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

	const handleOpen = useCallback(
		async (app: ExternalApplication) => {
			try {
				await window.astravia.shell.openPathWithApplication(rootDir, app.id);
				localStorage.setItem(STORAGE_KEY, app.id);
				setLastAppId(app.id);
			} catch (error: unknown) {
				console.error("Failed to open workspace with application", error);
			}
		},
		[rootDir],
	);

	// 优先显示上次使用的应用，其次是默认应用
	const sorted = [...applications].sort((a, b) => {
		if (a.id === lastAppId) return -1;
		if (b.id === lastAppId) return 1;
		if (a.isDefault && !b.isDefault) return -1;
		if (b.isDefault && !a.isDefault) return 1;
		return a.name.localeCompare(b.name);
	});

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-xs" title={t("fileExplorer.openWorkspaceWithApp")} onClick={() => void loadApplications()}>
					<span className="icon-[solar--export-linear] h-3.5 w-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[180px]">
				{loading || applications.length === 0 ? (
					<DropdownMenuItem disabled>{t("fileExplorer.noApplications")}</DropdownMenuItem>
				) : (
					sorted.map((app) => (
						<DropdownMenuItem key={app.id} onSelect={() => void handleOpen(app)}>
							<span className="flex w-full items-center justify-between gap-2">
								<span className="truncate">{app.name}</span>
								{app.id === lastAppId && <span className="icon-[solar--check-circle-linear] h-3.5 w-3.5 text-primary" />}
								{app.isDefault && app.id !== lastAppId && (
									<span className="text-[10px] text-muted-foreground">{t("fileExplorer.defaultApp")}</span>
								)}
							</span>
						</DropdownMenuItem>
					))
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

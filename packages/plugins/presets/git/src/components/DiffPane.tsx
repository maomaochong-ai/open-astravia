import { PatchDiff } from "@pierre/diffs/react";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { Component, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fileDiff } from "../git/run";
import type { ChangeEntry } from "../git/types";
import { DiffView } from "./DiffView";
import { useHostMode } from "./hostTheme";
import { CloseIcon, FileIcon, SidebarIcon } from "./icons";
import { StatusBadge } from "./StatusBadge";

/**
 * If `@pierre/diffs` fails to render a patch (e.g. highlighter init), fall back
 * to the self-contained {@link DiffView} so the pane stays usable.
 */
class DiffErrorBoundary extends Component<{ patch: string; children: ReactNode }, { failed: boolean }> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidUpdate(prev: { patch: string }): void {
		// 切到新 patch 时重置错误态，给富渲染器一次新机会。
		if (prev.patch !== this.props.patch && this.state.failed) this.setState({ failed: false });
	}

	render(): ReactNode {
		if (this.state.failed) return <DiffView patch={this.props.patch} />;
		return this.props.children;
	}
}

function basename(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? path : path.slice(i + 1);
}

/** Right-hand diff view for the selected change. Loads the patch and renders it. */
export function DiffPane({
	root,
	entry,
	onClose,
	onToggleTree,
	treeCollapsed,
}: {
	root: string;
	entry: ChangeEntry;
	onClose: () => void;
	onToggleTree: () => void;
	treeCollapsed: boolean;
}): JSX.Element {
	const mode = useHostMode();
	const { t } = useTranslation();
	const [patch, setPatch] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		setLoading(true);
		setError(null);
		setPatch(null);
		fileDiff(root, entry)
			.then((value) => {
				if (alive) setPatch(value);
			})
			.catch((err: unknown) => {
				if (alive) setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (alive) setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [root, entry]);

	const options = useMemo(
		() => ({
			theme: mode === "dark" ? "github-dark-default" : "github-light-default",
			diffStyle: "unified" as const,
			overflow: "wrap" as const,
			disableFileHeader: true,
		}),
		[mode],
	);

	// 把 diff 的基础/上下文/缓冲/分隔背景钉到宿主活动面板底色（--muted），
	// 保留 +/- 行的增删着色。-override 变量是库提供的覆盖入口。
	const diffStyle = {
		"--diffs-bg": "var(--muted)",
		"--diffs-bg-context-override": "var(--muted)",
		"--diffs-bg-context-gutter-override": "var(--muted)",
		"--diffs-bg-buffer-override": "var(--muted)",
		"--diffs-bg-separator-override": "var(--muted)",
	} as React.CSSProperties;

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onClick={onToggleTree}
					title={treeCollapsed ? t("action.showTree") : t("action.hideTree")}
				>
					<SidebarIcon className="h-3.5 w-3.5" />
				</Button>
				<FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
				<span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}>
					{basename(entry.path)}
				</span>
				<StatusBadge code={entry.code} />
				<Button type="button" variant="ghost" size="icon-xs" onClick={onClose} title={t("action.close")}>
					<CloseIcon className="h-3.5 w-3.5" />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				{loading && <div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.loading")}</div>}
				{error && <div className="px-3 py-2 text-[12px] text-rose-500">{error}</div>}
				{!loading &&
					!error &&
					patch !== null &&
					(patch.trim().length === 0 ? (
						<div className="px-3 py-2 text-[12px] text-muted-foreground">{t("diff.empty")}</div>
					) : (
						<DiffErrorBoundary patch={patch}>
							<PatchDiff patch={patch} options={options} style={diffStyle} disableWorkerPool />
						</DiffErrorBoundary>
					))}
			</div>
		</div>
	);
}

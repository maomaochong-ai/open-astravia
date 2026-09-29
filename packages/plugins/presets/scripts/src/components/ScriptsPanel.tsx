import { useBottomPanel, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta-org/ui";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getScriptsFs } from "../runtime";
import { discoverScripts } from "../scripts/discover";
import { countScripts, filterProjects } from "../scripts/filter";
import type { RunnableScript, ScriptProject } from "../scripts/model";
import { ProjectCard } from "./ProjectCard";

type LoadState =
	| { readonly kind: "loading" }
	| { readonly kind: "ready"; readonly projects: readonly ScriptProject[] }
	| { readonly kind: "error"; readonly message: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function basename(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, "");
	return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || trimmed;
}

function projectTitle(project: ScriptProject, rootName: string): string {
	return project.packageName ?? (project.relDir ? basename(project.relDir) : rootName);
}

/** 终端 tab 的名字：根目录的脚本只写脚本名，子项目前面带上项目名，多个 dev 才分得清。 */
function terminalLabel(project: ScriptProject, script: RunnableScript, rootName: string): string {
	return project.relDir ? `${projectTitle(project, rootName)}: ${script.name}` : script.name;
}

/**
 * 瀑布流：用 CSS 多列而不是网格。网格按行对齐，一行里最高的卡片决定行高，矮卡片下面
 * 就留出缺口；多列让每列自上而下紧贴着排，列数随面板宽度自动增减（每列至少 240px）。
 * 代价是阅读顺序变成先上下后左右——根目录那张仍在左上角。
 */
const MASONRY = "columns-[240px] gap-2.5 p-2.5";
/** 卡片不能被拆到两列里；间距用下边距，多列布局里 gap 只管列间。 */
const MASONRY_ITEM = "mb-2.5 break-inside-avoid";

/** 骨架也做成高低不一，加载完成时布局不会整体跳一下。 */
const SKELETON_HEIGHTS = ["h-28", "h-20", "h-36", "h-24"];

function Placeholder({ icon, title, description, tone = "muted" }: {
	readonly icon: string;
	readonly title: string;
	readonly description?: string;
	readonly tone?: "muted" | "error";
}): JSX.Element {
	return (
		<div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
			<span
				className={`flex size-10 items-center justify-center rounded-xl ${
					tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
				}`}
			>
				<span aria-hidden className={`${icon} size-5`} />
			</span>
			<p className="text-[13px] font-medium text-foreground">{title}</p>
			{description ? <p className="max-w-96 text-[12px] text-muted-foreground">{description}</p> : null}
		</div>
	);
}

export function ScriptsPanel(): JSX.Element {
	const { t } = useTranslation();
	const { cwd, openTerminal, revealInstance } = useBottomPanel();
	const [state, setState] = useState<LoadState>({ kind: "loading" });
	const [query, setQuery] = useState("");
	const [notice, setNotice] = useState<string | null>(null);
	/** 脚本 → 为它开过的终端。再点同一个脚本时切回那个终端，不重复起 dev server。 */
	const terminals = useRef(new Map<string, string>());
	const loadSeq = useRef(0);

	const load = useCallback(async () => {
		const fs = getScriptsFs();
		const seq = ++loadSeq.current;
		if (!cwd || !fs) {
			setState({ kind: "ready", projects: [] });
			return;
		}
		setState({ kind: "loading" });
		try {
			const projects = await discoverScripts(fs, cwd);
			if (seq === loadSeq.current) setState({ kind: "ready", projects });
		} catch (error) {
			if (seq === loadSeq.current) setState({ kind: "error", message: errorMessage(error) });
		}
	}, [cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	const rootName = cwd ? basename(cwd) : "";
	const projects = state.kind === "ready" ? state.projects : [];
	const visible = useMemo(() => filterProjects(projects, query), [projects, query]);
	const searching = query.trim().length > 0;

	const run = (project: ScriptProject, script: RunnableScript, options: { reuse: boolean }): void => {
		setNotice(null);
		const existing = terminals.current.get(script.key);
		if (options.reuse && existing && revealInstance(existing)) return;
		try {
			const instanceId = openTerminal({
				command: script.command,
				cwd: script.dir,
				label: terminalLabel(project, script, rootName),
			});
			terminals.current.set(script.key, instanceId);
		} catch (error) {
			setNotice(t("error.run", { message: errorMessage(error) }));
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col text-[12px] text-foreground">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-1.5">
				<label className="flex h-7 w-full max-w-72 items-center gap-1.5 rounded-md border border-border bg-background/70 px-2 transition-colors focus-within:border-primary/50">
					<span aria-hidden className="icon-[mdi--magnify] size-3.5 shrink-0 text-muted-foreground" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("search.placeholder")}
						aria-label={t("search.placeholder")}
						className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
					/>
					{searching ? (
						<button
							type="button"
							aria-label={t("search.clear")}
							onClick={() => setQuery("")}
							className="flex text-muted-foreground hover:text-foreground"
						>
							<span aria-hidden className="icon-[mdi--close-circle] size-3.5" />
						</button>
					) : null}
				</label>
				{state.kind === "ready" && projects.length > 0 ? (
					<span className="shrink-0 text-[11px] text-muted-foreground">
						{t("summary", { projects: projects.length, scripts: countScripts(projects) })}
					</span>
				) : null}
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={t("action.refresh")}
					title={t("action.refresh")}
					disabled={state.kind === "loading"}
					onClick={() => void load()}
				>
					<span
						aria-hidden
						className={`icon-[mdi--refresh] size-3.5 ${state.kind === "loading" ? "animate-spin" : ""}`}
					/>
				</Button>
			</div>
			{notice ? (
				<div
					role="alert"
					className="mx-2.5 mt-2 flex shrink-0 items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-destructive"
				>
					<span aria-hidden className="icon-[mdi--alert-circle-outline] mt-px size-3.5 shrink-0" />
					<span className="min-w-0 flex-1">{notice}</span>
					<button
						type="button"
						aria-label={t("action.dismiss")}
						onClick={() => setNotice(null)}
						className="flex opacity-70 hover:opacity-100"
					>
						<span aria-hidden className="icon-[mdi--close] size-3.5" />
					</button>
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{state.kind === "loading" ? (
					<div className={MASONRY} aria-label={t("state.loading")} aria-busy="true">
						{SKELETON_HEIGHTS.map((height) => (
							<div
								key={height}
								className={`${MASONRY_ITEM} ${height} animate-pulse rounded-xl border border-border bg-muted/40`}
							/>
						))}
					</div>
				) : state.kind === "error" ? (
					<Placeholder
						icon="icon-[mdi--alert-circle-outline]"
						tone="error"
						title={t("state.error.title")}
						description={state.message}
					/>
				) : projects.length === 0 ? (
					<Placeholder
						icon="icon-[mdi--script-text-play-outline]"
						title={t("state.empty.title")}
						description={t("state.empty.description")}
					/>
				) : visible.length === 0 ? (
					<Placeholder icon="icon-[mdi--magnify]" title={t("state.noMatch")} />
				) : (
					<div className={MASONRY}>
						{visible.map((project) => (
							<ProjectCard
								key={project.relDir}
								className={MASONRY_ITEM}
								project={project}
								title={projectTitle(project, rootName)}
								forceExpanded={searching}
								onRun={(script, options) => run(project, script, options)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

import { useBottomPanel, useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Input } from "@vetta-org/ui";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getScriptsFs } from "../runtime";
import { discoverScripts } from "../scripts/discover";
import { countScripts, filterProjects } from "../scripts/filter";
import type { RunnableScript, ScriptProject } from "../scripts/model";

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

const SOURCE_ICONS: Record<RunnableScript["source"], string> = {
	"package.json": "icon-[mdi--nodejs]",
	makefile: "icon-[mdi--hammer-wrench]",
};

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
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("search.placeholder")}
					aria-label={t("search.placeholder")}
					className="h-7 max-w-72 text-[12px]"
				/>
				{state.kind === "ready" ? (
					<span className="text-muted-foreground">{t("summary", { count: countScripts(projects) })}</span>
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
					<span aria-hidden className="icon-[mdi--refresh] size-3.5" />
				</Button>
			</div>
			{notice ? (
				<p role="alert" className="shrink-0 border-b border-border px-3 py-1.5 text-destructive">
					{notice}
				</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{state.kind === "loading" ? (
					<p className="px-3 py-4 text-muted-foreground">{t("state.loading")}</p>
				) : state.kind === "error" ? (
					<p className="px-3 py-4 text-destructive">{t("state.error", { message: state.message })}</p>
				) : projects.length === 0 ? (
					<div className="px-3 py-4 text-muted-foreground">
						<p className="text-foreground">{t("state.empty.title")}</p>
						<p className="mt-1">{t("state.empty.description")}</p>
					</div>
				) : visible.length === 0 ? (
					<p className="px-3 py-4 text-muted-foreground">{t("state.noMatch")}</p>
				) : (
					visible.map((project) => (
						<section key={project.relDir} aria-label={projectTitle(project, rootName)} className="py-1">
							<header className="flex items-baseline gap-2 px-3 pt-1.5 pb-1">
								<span className="font-medium">{projectTitle(project, rootName)}</span>
								<span className="truncate text-[11px] text-muted-foreground">{project.relDir || "."}</span>
								{project.packageManager ? (
									<span className="text-[11px] text-muted-foreground">{project.packageManager}</span>
								) : null}
							</header>
							<ul>
								{project.scripts.map((script) => (
									<li key={script.key} className="group flex items-center gap-1 pr-2 hover:bg-accent/50">
										<button
											type="button"
											className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-3 text-left"
											title={script.command}
											onClick={() => run(project, script, { reuse: true })}
										>
											<span aria-hidden className={`${SOURCE_ICONS[script.source]} size-3.5 shrink-0 text-muted-foreground`} />
											<span className="shrink-0 font-mono">{script.name}</span>
											{script.detail ? (
												<span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
													{script.detail}
												</span>
											) : null}
										</button>
										<Button
											variant="ghost"
											size="icon-xs"
											className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
											aria-label={t("action.runInNewTerminal", { name: script.name })}
											title={t("action.runInNewTerminal", { name: script.name })}
											onClick={() => run(project, script, { reuse: false })}
										>
											<span aria-hidden className="icon-[mdi--console-line] size-3.5" />
										</Button>
									</li>
								))}
							</ul>
						</section>
					))
				)}
			</div>
		</div>
	);
}

import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useState } from "react";
import type { RunnableScript, ScriptProject, ScriptSource } from "../scripts/model";

/** 卡片默认只露出这么多个脚本：一张卡太长会独占一整列，其它项目都被挤到后面去。 */
export const COLLAPSED_SCRIPT_LIMIT = 10;

export interface ProjectCardProps {
	readonly project: ScriptProject;
	readonly title: string;
	/** 外层布局给卡片的类名（瀑布流的防拆列与间距）。 */
	readonly className?: string;
	/** 搜索时展开全部命中项，不让匹配结果藏在「更多」后面。 */
	readonly forceExpanded: boolean;
	readonly onRun: (script: RunnableScript, options: { reuse: boolean }) => void;
}

const SOURCE_TONES: Record<ScriptSource, { icon: string; tile: string }> = {
	"package.json": {
		icon: "icon-[mdi--nodejs]",
		tile: "scripts-tone-node",
	},
	makefile: {
		icon: "icon-[mdi--hammer-wrench]",
		tile: "scripts-tone-make",
	},
};

function ScriptChip({
	script,
	onRun,
}: {
	readonly script: RunnableScript;
	readonly onRun: ProjectCardProps["onRun"];
}): JSX.Element {
	const { t } = useTranslation();
	const tooltip = script.detail ? `${script.command}\n${script.detail}` : script.command;
	return (
		<li className="group/chip inline-flex h-7 max-w-full items-stretch overflow-hidden rounded-md border border-border bg-background/70 text-[12px] transition-colors hover:border-primary/40 hover:bg-accent/60 focus-within:border-primary/50">
			<button
				type="button"
				title={tooltip}
				onClick={() => onRun(script, { reuse: true })}
				className="flex min-w-0 items-center gap-1.5 pr-2 pl-1.5 font-mono outline-none"
			>
				<span
					aria-hidden
					className="icon-[mdi--play] size-3.5 shrink-0 text-muted-foreground transition-colors group-hover/chip:text-primary"
				/>
				<span className="truncate">{script.name}</span>
			</button>
			<button
				type="button"
				aria-label={t("action.runInNewTerminal", { name: script.name })}
				title={t("action.runInNewTerminal", { name: script.name })}
				onClick={() => onRun(script, { reuse: false })}
				className="flex items-center border-l border-border px-1.5 text-muted-foreground opacity-0 outline-none transition-opacity group-hover/chip:opacity-100 hover:text-foreground focus-visible:opacity-100"
			>
				<span aria-hidden className="icon-[mdi--plus-box-multiple-outline] size-3.5" />
			</button>
		</li>
	);
}

function ScriptGroup({
	label,
	scripts,
	onRun,
}: {
	readonly label?: string;
	readonly scripts: readonly RunnableScript[];
	readonly onRun: ProjectCardProps["onRun"];
}): JSX.Element {
	return (
		<div className="flex flex-col gap-1.5">
			{label ? (
				<span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
			) : null}
			<ul className="flex flex-wrap gap-1.5">
				{scripts.map((script) => (
					<ScriptChip key={script.key} script={script} onRun={onRun} />
				))}
			</ul>
		</div>
	);
}

/** 一个子项目一张卡：标题区说明它是谁、在哪、用什么跑，下面是可以直接点的脚本芯片。 */
export function ProjectCard({ project, title, className, forceExpanded, onRun }: ProjectCardProps): JSX.Element {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const showAll = expanded || forceExpanded;
	const visible = showAll ? project.scripts : project.scripts.slice(0, COLLAPSED_SCRIPT_LIMIT);
	const hidden = project.scripts.length - visible.length;

	const packageScripts = visible.filter((script) => script.source === "package.json");
	const makeTargets = visible.filter((script) => script.source === "makefile");
	// 两种来源都有时才标小标题，只有一种时标题区的图标已经说清楚了。
	const labelled = packageScripts.length > 0 && makeTargets.length > 0;
	const primarySource: ScriptSource = project.scripts[0]?.source ?? "package.json";
	const tone = SOURCE_TONES[primarySource];

	return (
		<section
			aria-label={title}
			className={`flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card/70 p-3 text-card-foreground transition-colors hover:border-foreground/15 ${className ?? ""}`}
		>
			<header className="flex min-w-0 items-center gap-2.5">
				<span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone.tile}`}>
					<span aria-hidden className={`${tone.icon} size-4`} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<h3 className="truncate text-[13px] leading-5 font-medium">{title}</h3>
						{project.relDir === "" ? (
							<span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] leading-4 text-primary">
								{t("card.root")}
							</span>
						) : null}
					</div>
					<p className="truncate font-mono text-[11px] leading-4 text-muted-foreground">
						{project.relDir ? project.relDir : "./"}
					</p>
				</div>
				{project.packageManager ? (
					<span className="shrink-0 rounded-md border border-border px-1.5 font-mono text-[10px] leading-5 text-muted-foreground">
						{project.packageManager}
					</span>
				) : null}
			</header>
			{packageScripts.length > 0 ? (
				<ScriptGroup label={labelled ? t("card.scripts") : undefined} scripts={packageScripts} onRun={onRun} />
			) : null}
			{makeTargets.length > 0 ? (
				<ScriptGroup label={labelled ? "make" : undefined} scripts={makeTargets} onRun={onRun} />
			) : null}
			{hidden > 0 || (expanded && !forceExpanded && project.scripts.length > COLLAPSED_SCRIPT_LIMIT) ? (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					className="self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
				>
					{hidden > 0 ? t("card.showMore", { count: hidden }) : t("card.showLess")}
				</button>
			) : null}
		</section>
	);
}

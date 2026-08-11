import type { JSX } from "react";
import { Button } from "@vetta/ui";

export interface UpdateCheckerViewLabels {
	readonly check: string;
	readonly checking: string;
	readonly checkingBtn: string;
	readonly currentVersion: (version: string) => string;
	readonly download: string;
	readonly downloading: (progress: number) => string;
	readonly idle: (version: string) => string;
	readonly newVersion: (version: string) => string;
	readonly restart: string;
}

export type UpdateCheckerPhase =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "ready"
	| "installing"
	| "error";

export interface UpdateCheckerViewProps {
	readonly checking: boolean;
	readonly currentVersion: string;
	readonly labels: UpdateCheckerViewLabels;
	readonly latestVersion?: string;
	readonly onCheck: () => void;
	readonly onPrimary: () => void;
	readonly phase: UpdateCheckerPhase;
	readonly progress?: number;
	readonly releaseNote?: string;
	readonly statusText: string;
}

/** Settings 行右侧：与 App 引导同款 outline sm 按钮。 */
export function UpdateCheckerAction({
	checking,
	labels,
	onCheck,
}: Pick<UpdateCheckerViewProps, "checking" | "labels" | "onCheck">): JSX.Element {
	return (
		<Button size="sm" variant="outline" onClick={onCheck} disabled={checking}>
			<span className={`icon-[mdi--refresh] h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
			{checking ? labels.checkingBtn : labels.check}
		</Button>
	);
}

/** 有新版本时的详情卡片（放在 SettingRow 下方全宽）。 */
export function UpdateCheckerDetail({
	currentVersion,
	labels,
	latestVersion,
	onPrimary,
	phase,
	progress,
	releaseNote,
}: Pick<
	UpdateCheckerViewProps,
	"currentVersion" | "labels" | "latestVersion" | "onPrimary" | "phase" | "progress" | "releaseNote"
>): JSX.Element | null {
	if (phase !== "available" && phase !== "downloading" && phase !== "ready") {
		return null;
	}

	return (
		<div className="space-y-2 rounded-lg border border-border bg-secondary p-3">
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<span className="text-[13px] font-medium text-foreground">
						{labels.newVersion(latestVersion ?? "")}
					</span>
					<span className="ml-2 text-[12px] text-muted-foreground">
						{labels.currentVersion(currentVersion)}
					</span>
				</div>
				{phase === "available" && (
					<Button size="sm" variant="primary" onClick={onPrimary}>
						{labels.download}
					</Button>
				)}
				{phase === "downloading" && (
					<span className="shrink-0 text-[12px] text-muted-foreground">
						{labels.downloading(Math.round((progress ?? 0) * 100))}
					</span>
				)}
				{phase === "ready" && (
					<Button size="sm" variant="primary" onClick={onPrimary}>
						{labels.restart}
					</Button>
				)}
			</div>
			{releaseNote && <p className="whitespace-pre-wrap text-[12px] text-muted-foreground">{releaseNote}</p>}
		</div>
	);
}

/** 独立使用时：动作 + 详情纵向排列。设置页请用 Action / Detail 配合 SettingRow。 */
export function UpdateCheckerView(props: UpdateCheckerViewProps): JSX.Element {
	return (
		<div className="space-y-3">
			<div className="flex justify-end">
				<UpdateCheckerAction checking={props.checking} labels={props.labels} onCheck={props.onCheck} />
			</div>
			<UpdateCheckerDetail
				currentVersion={props.currentVersion}
				labels={props.labels}
				latestVersion={props.latestVersion}
				onPrimary={props.onPrimary}
				phase={props.phase}
				progress={props.progress}
				releaseNote={props.releaseNote}
			/>
		</div>
	);
}

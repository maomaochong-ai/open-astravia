import { useEffect, useRef, useState, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
	readonly viewMore?: string;
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
	readonly onViewMore?: () => void;
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
	phase,
}: Pick<UpdateCheckerViewProps, "checking" | "labels" | "onCheck" | "phase">): JSX.Element {
	return (
		<Button
			size="sm"
			variant="outline"
			onClick={onCheck}
			disabled={checking}
			data-testid="updater-check"
			data-updater-phase={phase}
		>
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
	onViewMore,
	phase,
	progress,
	releaseNote,
}: Pick<
	UpdateCheckerViewProps,
	"currentVersion" | "labels" | "latestVersion" | "onPrimary" | "onViewMore" | "phase" | "progress" | "releaseNote"
>): JSX.Element | null {
	if (phase !== "available" && phase !== "downloading" && phase !== "ready") {
		return null;
	}

	return (
		<div
			className="space-y-2 rounded-lg border border-border bg-secondary p-3"
			data-testid="updater-detail"
			data-updater-phase={phase}
		>
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
					<Button size="sm" variant="primary" onClick={onPrimary} data-testid="updater-primary">
						{labels.download}
					</Button>
				)}
				{phase === "downloading" && (
					<span className="shrink-0 text-[12px] text-muted-foreground">
						{labels.downloading(Math.round((progress ?? 0) * 100))}
					</span>
				)}
				{phase === "ready" && (
					<Button size="sm" variant="primary" onClick={onPrimary} data-testid="updater-primary">
						{labels.restart}
					</Button>
				)}
			</div>
			{releaseNote && (
				<ReleaseNotePreview
					releaseNote={releaseNote}
					viewMoreLabel={labels.viewMore ?? "View more"}
					onViewMore={onViewMore}
				/>
			)}
		</div>
	);
}

const MAX_LINES = 10;
// Line height ~1.5rem (24px) for 13px font text, 10 lines is ~240px
const MAX_HEIGHT_PX = 240;

function ReleaseNotePreview({
	releaseNote,
	viewMoreLabel,
	onViewMore,
}: {
	readonly releaseNote: string;
	readonly viewMoreLabel: string;
	readonly onViewMore?: () => void;
}): JSX.Element {
	const contentRef = useRef<HTMLDivElement>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;

		// 检查纯行数（通过换行统计作为下限）以及实际渲染像素高度
		const lineCount = releaseNote.split(/\r?\n/).length;
		if (lineCount > MAX_LINES || el.scrollHeight > MAX_HEIGHT_PX + 4) {
			setIsOverflowing(true);
		} else {
			setIsOverflowing(false);
		}
	}, [releaseNote]);

	return (
		<div className="relative mt-2">
			<div
				ref={contentRef}
				className={`markdown-body text-[12.5px] leading-[1.5] text-muted-foreground break-words ${
					isOverflowing ? "overflow-hidden" : ""
				}`}
				style={isOverflowing ? { maxHeight: `${MAX_HEIGHT_PX}px` } : undefined}
			>
				<ReactMarkdown remarkPlugins={[remarkGfm]}>
					{releaseNote}
				</ReactMarkdown>
			</div>
			{isOverflowing && (
				<div className="pt-6 -mt-6 bg-gradient-to-t from-secondary via-secondary/85 to-transparent flex items-center justify-center relative z-10">
					<button
						type="button"
						onClick={onViewMore}
						className="cursor-pointer inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline py-1 px-2 rounded hover:bg-muted/50 transition-colors"
					>
						<span>{viewMoreLabel}</span>
						<span className="icon-[mdi--chevron-right] h-3.5 w-3.5" />
					</button>
				</div>
			)}
		</div>
	);
}

/** 独立使用时：动作 + 详情纵向排列。设置页请用 Action / Detail 配合 SettingRow。 */
export function UpdateCheckerView(props: UpdateCheckerViewProps): JSX.Element {
	return (
		<div className="space-y-3">
			<div className="flex justify-end">
				<UpdateCheckerAction
					checking={props.checking}
					labels={props.labels}
					onCheck={props.onCheck}
					phase={props.phase}
				/>
			</div>
			<UpdateCheckerDetail
				currentVersion={props.currentVersion}
				labels={props.labels}
				latestVersion={props.latestVersion}
				onPrimary={props.onPrimary}
				onViewMore={props.onViewMore}
				phase={props.phase}
				progress={props.progress}
				releaseNote={props.releaseNote}
			/>
		</div>
	);
}

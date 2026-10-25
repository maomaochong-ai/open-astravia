import { useEffect, useRef, useState, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@astravia-org/ui";

import { normalizeReleaseNote } from "./release-note";

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
	const innerRef = useRef<HTMLDivElement>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);
	// GitHub 的 feed 给 HTML，Release API 给 Markdown：统一成 Markdown 再渲染，
	// 否则 HTML 会被当成纯文本原样显示。
	const markdown = normalizeReleaseNote(releaseNote);

	useEffect(() => {
		const el = innerRef.current;
		if (!el) return;

		// 裁切高度恒定，这里只判断内容有没有超出。测量必须跟着内容尺寸变化重跑：
		// 面板隐藏时挂载、字体晚到、窗口缩放都会让一次性测量得出错误结论，
		// 之后再也不重算就是长文本溢出卡片、盖住下面设置行的直接原因。
		const measure = () => {
			setIsOverflowing(el.getBoundingClientRect().height > MAX_HEIGHT_PX + 4);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [markdown]);

	return (
		<div className="relative mt-2">
			<div
				className="markdown-body overflow-hidden text-[12.5px] leading-[1.5] text-muted-foreground break-words"
				data-testid="updater-release-note"
				style={{ maxHeight: `${MAX_HEIGHT_PX}px` }}
			>
				<div ref={innerRef}>
					<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
				</div>
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

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Button } from "@astravia-org/ui";

import { outlineReleaseNote } from "./release-note";

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
	/** 「版本介绍」按钮文案；与 onViewCurrent 同时提供才显示按钮。 */
	readonly viewCurrent?: string;
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
	readonly onViewCurrent?: () => void;
	readonly phase: UpdateCheckerPhase;
	readonly progress?: number;
	readonly releaseNote?: string;
	readonly statusText: string;
}

/** Settings 行右侧：「版本介绍」（可选）+ 与 App 引导同款 outline sm 的检查更新按钮。 */
export function UpdateCheckerAction({
	checking,
	labels,
	onCheck,
	onViewCurrent,
	phase,
	progress,
}: Pick<
	UpdateCheckerViewProps,
	"checking" | "labels" | "onCheck" | "onViewCurrent" | "phase" | "progress"
>): JSX.Element {
	// 下载中不能再点检查更新：按钮直接变成不可点的下载进度，重新进入设置页也一致。
	const downloading = phase === "downloading";
	const busy = checking || downloading;
	return (
		<div className="flex items-center gap-2">
			{onViewCurrent && labels.viewCurrent && (
				<Button variant="field" onClick={onViewCurrent} data-testid="updater-view-current">
					<span className="icon-[mdi--sparkles-outline] h-3.5 w-3.5" />
					{labels.viewCurrent}
				</Button>
			)}
			<Button
				variant="field"
				onClick={onCheck}
				disabled={busy}
				data-testid="updater-check"
				data-updater-phase={phase}
			>
				<span className={`icon-[mdi--refresh] h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
				{downloading
					? labels.downloading(Math.round((progress ?? 0) * 100))
					: checking
						? labels.checkingBtn
						: labels.check}
			</Button>
		</div>
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
		<div
			className="space-y-2 overflow-hidden rounded-lg border border-border bg-secondary p-3"
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
				<ReleaseNotePreview releaseNote={releaseNote} />
			)}
		</div>
	);
}

// 说明区高度上限：约 10 行 12px 正文。超出部分在框内滚动，不撑开卡片。
const MAX_HEIGHT_PX = 240;

function ReleaseNotePreview({
	releaseNote,
}: {
	readonly releaseNote: string;
}): JSX.Element {
	// 解析结果按原始文本缓存：outline 每次渲染都新建对象，会让下面的 effect 每轮重跑，
	// 而那正是「Maximum update depth exceeded」的形状。依赖只钉在文本上。
	const outline = useMemo(() => outlineReleaseNote(releaseNote), [releaseNote]);


	return (
		// 外层负责「不越界」：卡片是圆角的，任何子节点都不能把自己的绘制溢出到圆角之外。
		<div
			className="mt-2"
			data-testid="updater-release-note-frame"
			style={{ borderRadius: "8px", overflow: "hidden" }}
		>
			{/* 滚动必须写在 style 里。`.markdown-body` 在 styles.css 里以非分层规则声明了
			    `overflow: visible`（防 vibrancy 合成层裁剪正文），非分层规则胜过 Tailwind 分层
			    工具类 —— 只写 `overflow-hidden` 会被它盖掉。这里不再借用 .markdown-body，
			    但内联 style 仍然保留：以后谁把类名改回去，裁剪也不会跟着没了。
			    用 auto 而不是 hidden：说明再长也停在框里自己滚，不必先点「查看更多」才能读完。 */}
			<div
				className="text-muted-foreground"
				data-testid="updater-release-note"
				style={{
					maxHeight: `${MAX_HEIGHT_PX}px`,
					overscrollBehavior: "contain",
					overflowX: "hidden",
					overflowY: "auto",
				}}
			>
				<div className="pr-1">
					{outline.date && (
						<div className="mb-2 text-[10.5px] tracking-wider text-muted-foreground/60">{outline.date}</div>
					)}
					{outline.sections.map((section, sectionIndex) => (
						<section
							className={sectionIndex === 0 ? "" : "mt-3"}
							data-testid="updater-release-note-section"
							key={`${sectionIndex}-${section.title ?? ""}`}
						>
							{section.title && (
								<div className="mb-1.5 flex items-center gap-2">
									<span className="shrink-0 text-[11px] font-semibold text-foreground/85">{section.title}</span>
									<span className="h-px min-w-2 flex-1 bg-border/70" />
								</div>
							)}
							<ol className="m-0 list-none space-y-1.5 p-0">
								{section.items.map((item, itemIndex) => (
									<li className="flex gap-2" data-testid="updater-release-note-item" key={`${itemIndex}-${item.body}`}>
										<span
											aria-hidden
											className="w-3.5 shrink-0 text-right text-[10.5px] font-medium tabular-nums text-muted-foreground/45"
										>
											{itemIndex + 1}
										</span>
										<div className="min-w-0 flex-1">
							{item.title ? (
								<>
									<div className="text-[12px] leading-snug font-medium text-foreground/90">{item.title}</div>
									{item.body && (
										<p className="mt-0.5 mb-0 text-[11.5px] leading-relaxed">{item.body}</p>
									)}
								</>
							) : (
								<p className="m-0 text-[11.5px] leading-relaxed">{item.body}</p>
							)}
										</div>
									</li>
								))}
							</ol>
						</section>
					))}
				</div>
			</div>
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
				phase={props.phase}
				progress={props.progress}
				releaseNote={props.releaseNote}
			/>
		</div>
	);
}

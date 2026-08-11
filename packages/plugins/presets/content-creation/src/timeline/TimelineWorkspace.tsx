import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Slider } from "@vetta/ui";
import { useEffect, useMemo, useState } from "react";
import type { TimelineClip, ContentProjectDocument } from "../project/types";

const MIN_TIMELINE_DURATION = 30;

function timelineDuration(project: ContentProjectDocument): number {
	const clipEnd = project.timeline.tracks.reduce(
		(maximum, track) => track.clips.reduce((trackMaximum, clip) => Math.max(trackMaximum, clip.start + clip.duration), maximum),
		0,
	);
	return Math.max(MIN_TIMELINE_DURATION, Math.ceil(clipEnd / 5) * 5);
}

function clipTitle(project: ContentProjectDocument, clip: TimelineClip, fallback: string): string {
	const source = project.graph.nodes.find((node) => node.id === clip.sourceNodeId);
	return source?.name?.trim() || fallback;
}

export function TimelineWorkspace({ project }: { project: ContentProjectDocument }) {
	const { t } = useTranslation();
	const duration = useMemo(() => timelineDuration(project), [project]);
	const [playhead, setPlayhead] = useState(0);
	const [playing, setPlaying] = useState(false);

	useEffect(() => {
		if (!playing) return;
		const timer = window.setInterval(() => {
			setPlayhead((current) => {
				const next = current + 0.1;
				if (next >= duration) {
					setPlaying(false);
					return 0;
				}
				return next;
			});
		}, 100);
		return () => window.clearInterval(timer);
	}, [duration, playing]);

	return (
		<div className="grid h-full min-h-0 min-w-0 flex-1 grid-rows-[minmax(180px,1fr)_minmax(220px,42%)]">
			<section className="flex min-h-0 items-center justify-center p-5">
				<div className="flex aspect-video max-h-full max-w-[780px] flex-col items-center justify-center gap-2.5 rounded-xl border border-border/60 bg-muted/35 text-muted-foreground">
					<span className="icon-[lucide--play] block size-10 shrink-0 opacity-70" aria-hidden="true" />
					<p className="m-0 text-sm">{t("preview.placeholder")}</p>
				</div>
			</section>
			<section className="flex min-h-0 flex-col border-t border-border/60 bg-card/35">
				<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-2.5 text-[11px] text-muted-foreground">
					<Button
						type="button"
						size="icon-sm"
						variant="ghost"
						title={t(playing ? "action.pause" : "action.play")}
						onClick={() => setPlaying((value) => !value)}
					>
						{playing ? (
							<span className="icon-[lucide--pause] block size-4 shrink-0" aria-hidden="true" />
						) : (
							<span className="icon-[lucide--play] block size-4 shrink-0" aria-hidden="true" />
						)}
					</Button>
					<span className="tabular-nums">
						{playhead.toFixed(1)}s / {duration.toFixed(1)}s
					</span>
					<Slider
						className="min-w-[120px] flex-1"
						min={0}
						max={duration}
						step={0.1}
						value={[playhead]}
						aria-label={t("timeline.playhead")}
						onValueChange={(value) => setPlayhead(value[0] ?? 0)}
					/>
				</div>
				<div className="grid h-6 shrink-0 grid-cols-[110px_minmax(0,1fr)] border-b border-border/50 text-[10px] text-muted-foreground">
					<span className="border-r border-border/50" />
					<div className="flex items-center justify-between px-1.5">
						{Array.from({ length: duration / 5 + 1 }, (_, index) => (
							<span key={index}>{index * 5}s</span>
						))}
					</div>
				</div>
				<div className="min-h-0 overflow-auto">
					{project.timeline.tracks.map((track, index) => (
						<div className="grid min-h-[58px] grid-cols-[110px_minmax(0,1fr)] border-b border-border/40" key={track.id}>
							<div className="flex items-center justify-between border-r border-border/50 px-2.5 text-[11px]">
								<strong className="font-medium">
									{t(`track.kind.${track.kind}`)} {index + 1}
								</strong>
								<span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
									{track.clips.length}
								</span>
							</div>
							<div className="relative m-1.5 rounded-lg bg-muted/40">
								{track.clips.map((clip) => (
									<div
										key={clip.id}
										className="absolute top-1 bottom-1 min-w-[18px] truncate rounded-lg border border-primary/45 bg-primary/15 p-1.5 text-[10px] text-foreground"
										style={{
											left: `${(clip.start / duration) * 100}%`,
											width: `${(clip.duration / duration) * 100}%`,
										}}
										title={`${clip.start.toFixed(1)}s – ${(clip.start + clip.duration).toFixed(1)}s`}
									>
										{clipTitle(project, clip, t("timeline.clip.untitled"))}
									</div>
								))}
								<div className="absolute inset-y-0 w-px bg-primary" style={{ left: `${(playhead / duration) * 100}%` }} />
							</div>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

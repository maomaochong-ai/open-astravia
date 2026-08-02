import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useEffect, useMemo, useState } from "react";
import type { TimelineClip, ContentProjectDocument } from "../domain/model";
import { PauseIcon, PlayIcon } from "./icons";

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
	return source?.data.label?.trim() || fallback;
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
		<div className="flex h-full min-h-0 flex-col gap-3 bg-background p-3">
			<section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70 bg-card">
				<div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
					<PlayIcon className="h-10 w-10" />
					<p>{t("preview.placeholder")}</p>
				</div>
			</section>
			<section className="shrink-0 overflow-hidden rounded-lg border border-border/70 bg-card">
				<div className="flex items-center gap-3 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
					<Button type="button" size="icon-sm" variant="ghost" title={t(playing ? "action.pause" : "action.play")} onClick={() => setPlaying((value) => !value)}>
						{playing ? <PauseIcon /> : <PlayIcon />}
					</Button>
					<span>{playhead.toFixed(1)}s / {duration.toFixed(1)}s</span>
					<input className="min-w-0 flex-1 accent-primary"
						type="range"
						min={0}
						max={duration}
						step={0.1}
						value={playhead}
						aria-label={t("timeline.playhead")}
						onChange={(event) => setPlayhead(Number(event.target.value))}
					/>
				</div>
				<div className="grid grid-cols-[96px_1fr] border-b border-border/60 px-3 py-1 text-[10px] text-muted-foreground">
					<span />
					<div className="flex justify-between">{Array.from({ length: duration / 5 + 1 }, (_, index) => <span key={index}>{index * 5}s</span>)}</div>
				</div>
				<div className="max-h-52 overflow-y-auto">
					{project.timeline.tracks.map((track, index) => (
						<div className="grid grid-cols-[96px_1fr] border-b border-border/50" key={track.id}>
							<div className="flex items-center justify-between gap-2 border-r border-border/50 px-3 py-3 text-xs">
								<strong>{t(`track.kind.${track.kind}`)} {index + 1}</strong>
								<span>{track.clips.length}</span>
							</div>
							<div className="relative min-h-14 bg-muted/20">
								{track.clips.map((clip) => (
									<div
										key={clip.id}
											className="absolute top-2 bottom-2 truncate rounded bg-primary/20 px-2 py-1 text-[10px] text-primary"
										style={{ left: `${(clip.start / duration) * 100}%`, width: `${(clip.duration / duration) * 100}%` }}
										title={`${clip.start.toFixed(1)}s – ${(clip.start + clip.duration).toFixed(1)}s`}
									>
										{clipTitle(project, clip, t("timeline.clip.untitled"))}
									</div>
								))}
								<div className="absolute inset-y-0 w-px bg-destructive" style={{ left: `${(playhead / duration) * 100}%` }} />
							</div>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

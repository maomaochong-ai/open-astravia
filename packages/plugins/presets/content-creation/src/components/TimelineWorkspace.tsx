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
		<div className="content-creation-timeline-workspace">
			<section className="content-creation-preview">
				<div className="content-creation-preview__screen">
					<PlayIcon className="h-10 w-10" />
					<p>{t("preview.placeholder")}</p>
				</div>
			</section>
			<section className="content-creation-timeline">
				<div className="content-creation-transport">
					<Button type="button" size="icon-sm" variant="ghost" title={t(playing ? "action.pause" : "action.play")} onClick={() => setPlaying((value) => !value)}>
						{playing ? <PauseIcon /> : <PlayIcon />}
					</Button>
					<span>{playhead.toFixed(1)}s / {duration.toFixed(1)}s</span>
					<input
						type="range"
						min={0}
						max={duration}
						step={0.1}
						value={playhead}
						aria-label={t("timeline.playhead")}
						onChange={(event) => setPlayhead(Number(event.target.value))}
					/>
				</div>
				<div className="content-creation-ruler">
					<span />
					<div>{Array.from({ length: duration / 5 + 1 }, (_, index) => <span key={index}>{index * 5}s</span>)}</div>
				</div>
				<div className="content-creation-tracks">
					{project.timeline.tracks.map((track, index) => (
						<div className="content-creation-track" key={track.id}>
							<div className="content-creation-track__label">
								<strong>{t(`track.kind.${track.kind}`)} {index + 1}</strong>
								<span>{track.clips.length}</span>
							</div>
							<div className="content-creation-track__lane">
								{track.clips.map((clip) => (
									<div
										key={clip.id}
										className="content-creation-clip"
										style={{ left: `${(clip.start / duration) * 100}%`, width: `${(clip.duration / duration) * 100}%` }}
										title={`${clip.start.toFixed(1)}s – ${(clip.start + clip.duration).toFixed(1)}s`}
									>
										{clipTitle(project, clip, t("timeline.clip.untitled"))}
									</div>
								))}
								<div className="content-creation-playhead" style={{ left: `${(playhead / duration) * 100}%` }} />
							</div>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}


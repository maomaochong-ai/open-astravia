import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { perfSessionSwitchRecordReactCommit } from "./perf-session-switch";

const recordCommit: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
	perfSessionSwitchRecordReactCommit(id, phase, actualDuration, baseDuration);
};

export function PerfSessionSwitchProfiler({ id, children }: { id: string; children: ReactNode }): JSX.Element {
	return (
		<Profiler id={id} onRender={recordCommit}>
			{children}
		</Profiler>
	);
}

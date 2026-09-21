import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { perfSessionSwitchEnabled, perfSessionSwitchRecordReactCommit } from "./perf-session-switch";

const recordCommit: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
	perfSessionSwitchRecordReactCommit(id, phase, actualDuration, baseDuration);
};

export function PerfSessionSwitchProfiler({ id, children }: { id: string; children: ReactNode }): JSX.Element {
	if (!perfSessionSwitchEnabled()) return <>{children}</>;
	return (
		<Profiler id={id} onRender={recordCommit}>
			{children}
		</Profiler>
	);
}

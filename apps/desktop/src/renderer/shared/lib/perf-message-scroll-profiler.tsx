import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { perfMessageScrollEnabled, perfMessageScrollRecordReactCommit } from "./perf-message-scroll";

const recordCommit: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
	perfMessageScrollRecordReactCommit(id, phase, actualDuration);
};

export function PerfMessageScrollProfiler({ children }: { readonly children: ReactNode }): JSX.Element {
	if (!perfMessageScrollEnabled()) return <>{children}</>;
	return (
		<Profiler id="MessageScroll" onRender={recordCommit}>
			{children}
		</Profiler>
	);
}

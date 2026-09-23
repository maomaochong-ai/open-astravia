import { PatchDiff } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import { Component, useMemo } from "react";
import { parseDiff } from "../git/parseDiff";
import { DiffView } from "./DiffView";
import { useHostMode } from "./hostTheme";

/**
 * If `@pierre/diffs` fails to render a patch (e.g. highlighter init), fall back
 * to the self-contained {@link DiffView} so the pane stays usable.
 */
class DiffErrorBoundary extends Component<{ patch: string; children: ReactNode }, { failed: boolean }> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidUpdate(prev: { patch: string }): void {
		// 切到新 patch 时重置错误态，给富渲染器一次新机会。
		if (prev.patch !== this.props.patch && this.state.failed) this.setState({ failed: false });
	}

	render(): ReactNode {
		if (this.state.failed) return <DiffView patch={this.props.patch} />;
		return this.props.children;
	}
}

/** Shared highlighted diff and fallback for working changes and commit history. */
export function PatchContent({
	patch,
	diffStyle = "unified",
}: {
	patch: string;
	diffStyle?: "unified" | "split";
}): JSX.Element {
	const mode = useHostMode();
	const parsed = useMemo(() => parseDiff(patch), [patch]);
	const options = useMemo(
		() => ({
			theme: mode === "dark" ? "github-dark-default" : "github-light-default",
			diffStyle,
			overflow: "wrap" as const,
			disableFileHeader: true,
		}),
		[mode, diffStyle],
	);

	// diff 区用 --background、文件列用 --muted：两块区域靠表面色分层，而不是靠一条竖线。
	// 保留 +/- 行的增删着色。-override 变量是库提供的覆盖入口。
	const diffCssVars = {
		"--diffs-bg": "var(--background)",
		"--diffs-bg-context-override": "var(--background)",
		"--diffs-bg-context-gutter-override": "var(--background)",
		"--diffs-bg-buffer-override": "var(--background)",
		"--diffs-bg-separator-override": "var(--background)",
	} as React.CSSProperties;

	if (parsed.binary || parsed.lines.length === 0) return <DiffView patch={patch} />;
	return (
		<DiffErrorBoundary patch={patch}>
			<PatchDiff patch={patch} options={options} style={diffCssVars} disableWorkerPool />
		</DiffErrorBoundary>
	);
}

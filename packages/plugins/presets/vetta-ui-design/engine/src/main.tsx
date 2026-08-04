import "./styles.css";
import { Component, type ComponentType, lazy, type ReactNode, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
	armReloadOnNextUpdate,
	installBridge,
	latestBuildError,
	notifyFrameError,
	notifyFrameRendered,
	onBuildError,
} from "./bridge";

interface FrameModule {
	default?: ComponentType;
	frame?: { width?: number; height?: number; title?: string };
}

/**
 * 按 frame 懒加载：一个 frame 写坏了只该坏它自己。eager 时所有 frame 在同一个
 * 模块里，任意一处语法错都会让入口整体编译失败，画布上每一帧一起变红。
 * 导出快照仍是单 chunk——由 vite.config 的 inlineDynamicImports 保证。
 */
const loaders = import.meta.glob<FrameModule>("@design/frames/*.tsx");

const frames = new Map<string, () => Promise<FrameModule>>();
for (const [path, load] of Object.entries(loaders)) {
	const id = path.split("/").pop()?.replace(/\.tsx$/, "");
	if (id) frames.set(id, load);
}

function currentFrameId(): string | null {
	const match = window.location.hash.match(/#\/frame\/([^/?]+)/);
	if (match) return decodeURIComponent(match[1]);
	return null;
}

// Packaged-snapshot previews load via srcdoc (no URL), so the frame id can also
// arrive by postMessage ("vetd:show-frame") instead of the hash.
let requestedId: string | null = currentFrameId();

function Placeholder({ text }: { text: string }) {
	return (
		<div
			style={{
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontFamily: "system-ui, sans-serif",
				color: "#9ca3af",
				fontSize: 13,
			}}
		>
			{text}
		</div>
	);
}

function FrameMissing({ id }: { id: string | null }) {
	return <Placeholder text={id ? `Frame not found: ${id}` : "No frame selected"} />;
}

const lazyFrames = new Map<string, ComponentType>();

function frameComponent(id: string): ComponentType | null {
	const load = frames.get(id);
	if (!load) return null;
	const cached = lazyFrames.get(id);
	if (cached) return cached;
	// 失败的 promise 会被 lazy 记住，但错误态的恢复走整页重载，缓存不用作废。
	const Frame = lazy(async () => {
		const mod = await load();
		return { default: mod.default ?? (() => <FrameMissing id={id} />) };
	});
	lazyFrames.set(id, Frame);
	return Frame;
}

interface BoundaryProps {
	frameId: string;
	children: ReactNode;
}

/**
 * 编译失败/渲染抛错的兜底。画面交给画布：它会继续盖住上一张位图并在标题栏打
 * 「构建失败」徽标，所以这里只留一句最低限度的文字，不做红屏。
 */
class FrameBoundary extends Component<BoundaryProps, { failed: boolean }> {
	state = { failed: false };
	private message: string | null = null;
	private disposeBuildError: (() => void) | null = null;

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidCatch(error: Error): void {
		// import 失败自己只会说「Failed to fetch dynamically imported module」，
		// 真正有用的 babel 报错来自 vite 的 error 事件，可能晚一步到。
		this.report(latestBuildError() ?? error.message);
		this.disposeBuildError = onBuildError((message) => this.report(message));
		armReloadOnNextUpdate();
	}

	// 每次渲染画布都会先收到一条「清空」，错误态要跟着补发回去。
	componentDidUpdate(): void {
		if (this.message) notifyFrameError(this.props.frameId, this.message);
	}

	componentWillUnmount(): void {
		this.disposeBuildError?.();
	}

	private report(message: string): void {
		this.message = message;
		notifyFrameError(this.props.frameId, message);
	}

	render(): ReactNode {
		if (this.state.failed) return <Placeholder text="Build failed" />;
		return this.props.children;
	}
}

const container = document.getElementById("root");
if (!container) throw new Error("engine root missing");
const root = createRoot(container);

function render(): void {
	const id = requestedId;
	const Frame = id ? frameComponent(id) : null;
	root.render(
		<StrictMode>
			{Frame && id ? (
				<FrameBoundary key={id} frameId={id}>
					<Suspense fallback={null}>
						<Frame />
					</Suspense>
				</FrameBoundary>
			) : (
				<FrameMissing id={id} />
			)}
		</StrictMode>,
	);
	notifyFrameRendered(id, [...frames.keys()]);
	// 先清空：这次渲染若再次失败，边界会在稍后补发真正的错误。
	notifyFrameError(id, null);
}

window.addEventListener("hashchange", () => {
	requestedId = currentFrameId();
	render();
});

installBridge({
	getFrameId: () => requestedId,
	showFrame: (id) => {
		requestedId = id;
		render();
	},
});

render();

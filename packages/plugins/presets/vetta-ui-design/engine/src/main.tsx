import "./styles.css";
import {
	Component,
	type ComponentType,
	lazy,
	type ReactNode,
	StrictMode,
	Suspense,
	useEffect,
	useLayoutEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import {
	armReloadOnNextUpdate,
	installBridge,
	installNavigator,
	latestBuildError,
	notifyFrameError,
	notifyFrameRendered,
	notifyNavigated,
	onBuildError,
} from "./bridge";
import { HOME_FRAME_ID, frameOfPath, homeFrameId, pathOfFrame } from "./routes";

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

const frameIds = [...frames.keys()].sort();

/**
 * 当前地址对应的 frame id。bridge 的每条消息都要带它，而它现在由路由决定，
 * 所以由 {@link NavigationBridge} 在每次地址变化时写进来。
 */
let currentFrameId: string | null = frameOfPath(window.location.pathname, frameIds);

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

/**
 * 「这一帧真的画到屏幕上了」的信号源。
 *
 * 以前 rendered 是在 root.render() 之后立刻发的，但那时 lazy 的 frame chunk 往往
 * 还没到（Suspense fallback 是 null），画面其实是空白——画布拿它换位图就会露出白底。
 * 放进 Suspense 内部、Frame 之后：chunk 到齐才会提交，layout effect 在 Frame 的 DOM
 * 落定后运行，再等两帧确保浏览器已经绘制过一次。
 */
function FramePainted({ frameId }: { frameId: string | null }) {
	// 不给依赖数组：每次提交都重新确认一次，HMR 换内容后画布也能拿到新的交接点。
	useLayoutEffect(() => {
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => notifyFrameRendered(frameId, [...frames.keys()]));
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	});
	return null;
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

function FrameRoute({ id }: { id: string }) {
	const Frame = frameComponent(id);
	// 渲染期就把错误清掉，而不是放进 effect：边界的 componentDidUpdate 在 commit
	// 阶段补发真正的错误，而 commit 晚于 render——顺序反过来的话，这条清空会把
	// 边界刚报上去的错误抹掉，画布上的「构建失败」徽标就再也亮不起来。
	notifyFrameError(id, null);
	if (!Frame) {
		return (
			<>
				<FrameMissing id={id} />
				<FramePainted frameId={id} />
			</>
		);
	}
	return (
		<FrameBoundary key={id} frameId={id}>
			<Suspense fallback={null}>
				<Frame />
				<FramePainted frameId={id} />
			</Suspense>
		</FrameBoundary>
	);
}

function NotFound() {
	return (
		<>
			<FrameMissing id={null} />
			<FramePainted frameId={null} />
		</>
	);
}

/**
 * 路由与 bridge 的接线：把 navigate 交给 bridge（预览工具条的前进/后退/换帧都
 * 从那边过来），并在每次地址变化时把当前地址报回去。
 */
function NavigationBridge() {
	const navigate = useNavigate();
	const location = useLocation();
	useEffect(() => {
		installNavigator((to) => {
			if (typeof to === "number") navigate(to);
			else navigate(to);
		});
	}, [navigate]);
	useEffect(() => {
		currentFrameId = frameOfPath(location.pathname, frameIds);
		notifyNavigated(location.pathname, currentFrameId);
	}, [location.pathname]);
	return null;
}

function App() {
	const home = homeFrameId(frameIds);
	return (
		<>
			<NavigationBridge />
			<Routes>
				<Route
					path="/"
					element={
						home === null ? (
							<NotFound />
						) : home === HOME_FRAME_ID ? (
							<FrameRoute id={HOME_FRAME_ID} />
						) : (
							// 没有 index.tsx 时首页借给第一帧，部署出去的根地址才不是空白。
							<Navigate to={pathOfFrame(home)} replace />
						)
					}
				/>
				{frameIds
					.filter((id) => id !== HOME_FRAME_ID)
					.map((id) => (
						<Route key={id} path={pathOfFrame(id)} element={<FrameRoute id={id} />} />
					))}
				<Route path="*" element={<NotFound />} />
			</Routes>
		</>
	);
}

const container = document.getElementById("root");
if (!container) throw new Error("engine root missing");
const root = createRoot(container);

/**
 * 导出快照经 srcdoc 加载，没有可写的 URL——history 在 `about:srcdoc` 下用不了，
 * BrowserRouter 一导航就抛。那条链路改用内存路由，其余（画布 iframe / 系统
 * 浏览器 / 部署后的站点）一律走真实地址。
 */
const Router = window.location.protocol === "about:" || window.location.protocol === "blob:" ? MemoryRouter : BrowserRouter;

root.render(
	<StrictMode>
		<Router>
			<App />
		</Router>
	</StrictMode>,
);

installBridge({ getFrameId: () => currentFrameId });

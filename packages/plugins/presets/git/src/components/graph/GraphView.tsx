import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { graphLog, listBranches } from "../../git/log";
import { parseLog } from "../../git/parseLog";
import { onRefreshSignal, resizePanel } from "../../git/runtime";
import type { BranchRef, CommitNode, GraphSelection } from "../../git/types";
import { SplitHandle } from "../SplitHandle";
import { BranchSelector } from "./BranchSelector";
import type { CommitMenuTarget } from "./CommitActions";
import { CommitActions } from "./CommitActions";
import { CommitDetailPane } from "./CommitDetailPane";
import { GitGraphCanvas } from "./GitGraphCanvas";

const PAGE = 200;
// 容器宽于此值才显示右侧详情面板；窄于此值只显示 graph（与 changes 视图同一套门控）。
const DETAIL_MIN_WIDTH = 460;
// 关闭详情时把面板收窄到此宽度（低于阈值即收起详情，回到只剩 graph）。
const COLLAPSE_WIDTH = 380;
const GRAPH_DEFAULT_WIDTH = 260;
const GRAPH_MIN_WIDTH = 180;
// 详情展开时给右侧保留的最小宽度，限制 graph 列最大宽度。
const DETAIL_RESERVED_WIDTH = 300;

type Status = "loading" | "ready" | "error";

/** Graph sub-view: top branch switcher, left commit graph, right commit detail (width-gated). */
export function GraphView({ root, reloadToken }: { root: string; reloadToken: number }): JSX.Element {
	const { t } = useTranslation();
	const [selection, setSelection] = useState<GraphSelection>({ scope: "local", branch: null });
	const [branches, setBranches] = useState<BranchRef[]>([]);
	const [nodes, setNodes] = useState<CommitNode[]>([]);
	const [status, setStatus] = useState<Status>("loading");
	const [errMsg, setErrMsg] = useState("");
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [selectedHash, setSelectedHash] = useState<string | null>(null);
	const [menu, setMenu] = useState<CommitMenuTarget | null>(null);
	const [refresh, setRefresh] = useState(0);
	useEffect(() => onRefreshSignal(() => setRefresh((n) => n + 1)), []);
	const loadIdRef = useRef(0);
	const loadingMoreRef = useRef(false);

	const containerRef = useRef<HTMLDivElement>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	const [graphWidth, setGraphWidth] = useState(GRAPH_DEFAULT_WIDTH);

	// Branch list for the current scope (independent of the graph window).
	useEffect(() => {
		let alive = true;
		listBranches(root, selection.scope)
			.then((list) => alive && setBranches(list))
			.catch(() => alive && setBranches([]));
		return () => {
			alive = false;
		};
	}, [root, selection.scope, reloadToken, refresh]);

	// (Re)load the first window whenever selection / root / refresh changes.
	useEffect(() => {
		const id = ++loadIdRef.current;
		loadingMoreRef.current = false;
		setLoadingMore(false);
		setStatus("loading");
		setNodes([]);
		setSelectedHash(null);
		setMenu(null);
		graphLog(root, selection, PAGE, 0)
			.then((raw) => {
				if (id !== loadIdRef.current) return;
				const parsed = parseLog(raw);
				setNodes(parsed);
				setHasMore(parsed.length === PAGE);
				setStatus("ready");
			})
			.catch((err: unknown) => {
				if (id !== loadIdRef.current) return;
				setErrMsg(err instanceof Error ? err.message : String(err));
				setStatus("error");
			});
		return () => {
			++loadIdRef.current;
		};
	}, [root, selection, reloadToken, refresh]);

	// Auto-pagination: guarded by a ref so rapid scroll events can't double-fire.
	const loadMore = useCallback(() => {
		if (loadingMoreRef.current || !hasMore || status !== "ready") return;
		const id = loadIdRef.current;
		loadingMoreRef.current = true;
		setLoadingMore(true);
		graphLog(root, selection, PAGE, nodes.length)
			.then((raw) => {
				if (id !== loadIdRef.current) return;
				const more = parseLog(raw);
				setNodes((prev) => [...prev, ...more]);
				setHasMore(more.length === PAGE);
			})
			.catch(() => {})
			.finally(() => {
				if (id !== loadIdRef.current) return;
				loadingMoreRef.current = false;
				setLoadingMore(false);
			});
	}, [root, selection, nodes.length, hasMore, status]);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const observer = new ResizeObserver((items) => {
			for (const item of items) setContainerWidth(item.contentRect.width);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const wide = containerWidth >= DETAIL_MIN_WIDTH;
	const selectedNode = selectedHash ? (nodes.find((n) => n.hash === selectedHash) ?? null) : null;
	const showDetail = wide && selectedNode !== null;

	// 点击节点：选中并把面板拉到最大（仿文件面板，用户明确要求每次点都拉满）。
	const handleSelect = useCallback((hash: string) => {
		setSelectedHash(hash);
		resizePanel("max");
	}, []);

	// 关闭详情：收窄到阈值以下，回到只剩 graph。
	const handleClose = useCallback(() => {
		setSelectedHash(null);
		resizePanel(COLLAPSE_WIDTH);
	}, []);

	const onSplitDrag = useCallback(
		(deltaX: number) => {
			setGraphWidth((w) => {
				const max = Math.max(GRAPH_MIN_WIDTH, containerWidth - DETAIL_RESERVED_WIDTH);
				return Math.max(GRAPH_MIN_WIDTH, Math.min(max, w + deltaX));
			});
		},
		[containerWidth],
	);

	const graphBody = (
		<div className="flex min-h-0 flex-1 flex-col">
			{status === "loading" && (
				<div className="px-3 py-4 text-[12px] text-muted-foreground">{t("state.loading")}</div>
			)}
			{status === "error" && <div className="px-3 py-4 text-[12px] text-rose-500">{errMsg}</div>}
			{status === "ready" &&
				(nodes.length === 0 ? (
					<div className="px-3 py-4 text-[12px] text-muted-foreground">{t("list.empty")}</div>
				) : (
					<>
						<GitGraphCanvas
							nodes={nodes}
							selectedHash={selectedHash}
							onSelect={handleSelect}
							onReachEnd={loadMore}
							onContextMenu={(node, event) => {
								event.preventDefault();
								setMenu({ node, x: event.clientX, y: event.clientY });
							}}
						/>
						{loadingMore && (
							<div className="shrink-0 border-t border-border py-1.5 text-center text-[12px] text-muted-foreground">
								{t("state.loading")}
							</div>
						)}
					</>
				))}
		</div>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<CommitActions key={root} root={root} target={menu} onClose={() => setMenu(null)} />
			<BranchSelector selection={selection} branches={branches} onChange={setSelection} />
			<div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
				{showDetail ? (
					<div
						className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-border"
						style={{ width: graphWidth }}
					>
						{graphBody}
						<SplitHandle onDrag={onSplitDrag} />
					</div>
				) : (
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">{graphBody}</div>
				)}
				{showDetail && selectedNode && (
					<CommitDetailPane
						key={`${root}:${selectedNode.hash}`}
						root={root}
						node={selectedNode}
						onClose={handleClose}
					/>
				)}
			</div>
		</div>
	);
}

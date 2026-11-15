import type { JSX } from "react";
import { isMac } from "../utils/platform";

export function AppBootLoadingView(): JSX.Element {
	return (
		<div className="flex h-screen w-screen overflow-hidden bg-background p-2" aria-busy="true">
			{/*
			 * 侧边栏骨架与真实侧边栏同形：贴住窗口左/上/下边、无圆角、只有右侧一条分隔线。
			 * 早先这里用的是「圆角 + 四周边框 + 留白」的悬浮样式，启动时会先看到一版悬浮侧栏、
			 * 再跳成贴边的经典侧栏——与 styles.css 里 .sidebar-dock 的贴边规则矛盾，属历史残留。
			 * `-m-2` 抵消 AppFrame 的 8px 内边距，与 .sidebar-dock 的 `-0.5rem` 负 margin 同源。
			 */}
			<div className="-ml-2 -mt-2 -mb-2 flex w-[220px] shrink-0 flex-col border-r border-border bg-muted p-3">
				{/* macOS 用 hiddenInset 标题栏，交通灯就落在窗口左上角（trafficLightPosition x:16 y:20），
				    这里不画骨架块，只留等高占位——否则脉冲方块正压在红黄绿三个按钮下面。
				    留占位而非直接删，是为了下方条目不会上移到交通灯区域。 */}
				{isMac ? (
					<div className="h-8" />
				) : (
					<div className="h-8 w-24 animate-pulse rounded-lg bg-foreground/10" />
				)}
				<div className="mt-6 space-y-2">
					{Array.from({ length: 4 }, (_, index) => (
						<div key={index} className="h-8 animate-pulse rounded-lg bg-foreground/5" />
					))}
				</div>
				<div className="mt-6 h-3 w-20 animate-pulse rounded bg-foreground/10" />
				<div className="mt-3 space-y-2">
					{Array.from({ length: 5 }, (_, index) => (
						<div key={index} className="flex items-center gap-2 px-2 py-1.5">
							<div className="h-4 w-4 animate-pulse rounded-md bg-foreground/10" />
							<div className="h-3 flex-1 animate-pulse rounded bg-foreground/5" />
						</div>
					))}
				</div>
			</div>
			<div className="flex min-w-0 flex-1 flex-col px-6 py-4">
				<div className="flex items-center justify-between">
					<div className="h-5 w-36 animate-pulse rounded bg-foreground/10" />
					<div className="h-8 w-20 animate-pulse rounded-lg bg-foreground/5" />
				</div>
				<div className="mx-auto mt-12 flex w-full max-w-4xl flex-1 flex-col gap-4">
					<div className="h-8 w-52 animate-pulse rounded-lg bg-foreground/10" />
					<div className="h-3 w-80 max-w-full animate-pulse rounded bg-foreground/5" />
					<div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
						{Array.from({ length: 6 }, (_, index) => (
							<div
								key={index}
								className="h-28 animate-pulse rounded-xl border border-border/40 bg-card/30"
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

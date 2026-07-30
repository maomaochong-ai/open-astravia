import { Button, cn } from "@vetta/ui";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type { SubscriptionCardsViewModel } from "./SubscriptionCardsView";

/** 订阅区操作按钮（刷新 + 升级），渲染在账户页顶部右上角。 */
export function SubscriptionActionsView({ model }: { model: SubscriptionCardsViewModel }): JSX.Element {
	const [showDone, setShowDone] = useState(false);
	const prevRefreshing = useRef(model.refreshing);
	const refreshLabel = showDone
		? model.labels.updated
		: model.refreshing
			? model.labels.refreshing
			: model.labels.refresh;

	useEffect(() => {
		if (prevRefreshing.current && !model.refreshing) {
			setShowDone(true);
			const timer = setTimeout(() => setShowDone(false), 1600);
			prevRefreshing.current = model.refreshing;
			return () => clearTimeout(timer);
		}
		prevRefreshing.current = model.refreshing;
	}, [model.refreshing]);

	return (
		<div className="flex shrink-0 items-center gap-1">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				onClick={() => void model.actions.refresh()}
				disabled={model.refreshing}
				title={refreshLabel}
				aria-label={refreshLabel}
				className={cn("h-7 w-7 shrink-0", showDone && "text-emerald-400")}
			>
				{showDone ? (
					<span className="icon-[solar--check-circle-linear] h-3.5 w-3.5" />
				) : (
					<span
						className={cn(
							"icon-[solar--refresh-linear] h-3.5 w-3.5",
							model.refreshing && "animate-spin",
						)}
					/>
				)}
			</Button>
			{model.actions.upgrade && model.labels.upgrade ? (
				<Button
					type="button"
					variant="default"
					size="sm"
					onClick={() => model.actions.upgrade?.()}
					className="h-7 gap-1.5 px-2 text-[12px] font-medium"
				>
					<span className="icon-[solar--course-up-linear] h-3.5 w-3.5" />
					{model.labels.upgrade}
				</Button>
			) : null}
		</div>
	);
}

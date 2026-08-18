interface DragTargetProps {
	iconUrl: string;
	hint: string;
	onDragStart: () => void;
}

/** 拖拽授权区：显示主 app 图标，拖拽发起时通知 main 用 helper.app 走原生 startDrag。 */
export function DragTarget({ iconUrl, hint, onDragStart }: DragTargetProps): JSX.Element {
	return (
		<div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/70 bg-secondary/40 px-4 py-5">
			<img
				src={iconUrl}
				alt=""
				draggable
				onDragStart={(event) => {
					event.preventDefault();
					onDragStart();
				}}
				className="h-12 w-12 shrink-0 cursor-grab select-none rounded-lg active:cursor-grabbing"
			/>
			<p className="text-center text-[12px] text-muted-foreground">{hint}</p>
		</div>
	);
}

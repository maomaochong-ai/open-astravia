import { Handle, Position } from "@xyflow/react";
import { cn } from "@vetta/ui";
import {
	CONTENT_FLOW_LEFT_ACTION_HANDLE_ID,
	CONTENT_FLOW_RIGHT_ACTION_HANDLE_ID,
	CONTENT_FLOW_SOURCE_HANDLE_ID,
	CONTENT_FLOW_TARGET_HANDLE_ID,
} from "../canvas/flow-handles";
import { AddIcon } from "../shared/icons";

interface ContentNodeHandleProps {
	label: string;
	side: "left" | "right";
	type: "source" | "target";
	active: boolean;
	selected: boolean;
}

export function ContentNodeHandle({ label, side, type, active, selected }: ContentNodeHandleProps) {
	const isLeft = side === "left";
	const position = isLeft ? Position.Left : Position.Right;

	return (
		<>
			<Handle
				type={isLeft ? "target" : "source"}
				id={isLeft ? CONTENT_FLOW_TARGET_HANDLE_ID : CONTENT_FLOW_SOURCE_HANDLE_ID}
				position={position}
				isConnectable={false}
				aria-hidden
				className={cn(
					"content-creation-edge-anchor !h-px !w-px !min-w-0 !border-0 !bg-transparent !opacity-0 !shadow-none",
					isLeft ? "content-creation-edge-anchor-left" : "content-creation-edge-anchor-right",
				)}
			/>
			<Handle
				type={type}
				id={isLeft ? CONTENT_FLOW_LEFT_ACTION_HANDLE_ID : CONTENT_FLOW_RIGHT_ACTION_HANDLE_ID}
				position={position}
				aria-label={label}
				className={cn(
					"content-creation-node-action-handle !z-20 !flex !h-10 !w-10 !items-center !justify-center",
					isLeft ? "content-creation-node-action-handle-left" : "content-creation-node-action-handle-right",
					"!border-0 !bg-transparent !opacity-100 !shadow-none !outline-none",
				)}
			>
				<span
					className={cn(
						"pointer-events-none grid size-6 place-items-center rounded-full border bg-popover text-muted-foreground shadow-md ring-1 ring-background transition-[opacity,transform,color,border-color] duration-150",
						selected
							? "scale-100 border-primary/55 text-primary opacity-100"
							: active
								? "scale-90 border-border text-muted-foreground opacity-100"
								: "scale-75 border-border opacity-0 group-hover:scale-90 group-hover:opacity-100",
					)}
					aria-hidden
				>
					<AddIcon className="size-3.5" />
				</span>
			</Handle>
		</>
	);
}

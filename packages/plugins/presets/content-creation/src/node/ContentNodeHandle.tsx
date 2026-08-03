import { Handle, Position } from "@xyflow/react";
import { cn } from "@vetta/ui";
import { CONTENT_FLOW_SOURCE_HANDLE_ID, CONTENT_FLOW_TARGET_HANDLE_ID } from "../canvas/flow-handles";

interface ContentNodeHandleProps {
	label: string;
	side: "left" | "right";
	active: boolean;
}

export function ContentNodeHandle({ label, side, active }: ContentNodeHandleProps) {
	const isLeft = side === "left";

	return (
		<Handle
			type={isLeft ? "target" : "source"}
			id={isLeft ? CONTENT_FLOW_TARGET_HANDLE_ID : CONTENT_FLOW_SOURCE_HANDLE_ID}
			position={isLeft ? Position.Left : Position.Right}
			aria-label={label}
			className={cn(
				"content-creation-node-handle !z-20 !flex !h-10 !w-5 !items-center !justify-center",
				"!border-0 !bg-transparent !opacity-100 !shadow-none !outline-none",
			)}
		>
			<span
				className={cn(
					"pointer-events-none size-1.5 rounded-full bg-muted-foreground transition-opacity duration-150",
					active ? "opacity-60" : "opacity-0 group-hover:opacity-60",
				)}
				aria-hidden
			/>
		</Handle>
	);
}

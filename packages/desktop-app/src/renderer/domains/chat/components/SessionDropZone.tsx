import { SessionDropZoneView } from "@vetta/theme-ui/chat";
import { useSessionDropZoneModel } from "../hooks/useSessionDropZoneModel";

interface SessionDropZoneProps {
	/** Optional cwd used when no activeSession yet (e.g. NewSessionPage). */
	cwdOverride?: string;
	className?: string;
	children: React.ReactNode;
}

/**
 * 输入区 drop 区。只包裹 InputBar，避免抢占消息列表和右侧文件面板的拖放事件；
 * 把 OS 拖入的图片送到 attachedImages、其他文件/目录送到 mentionedFiles；
 * 应用内 File Explorer 的拖拽（携带 application/vetta-path）同样进 mentionedFiles。
 */
export function SessionDropZone({ cwdOverride, className, children }: SessionDropZoneProps): JSX.Element {
	const model = useSessionDropZoneModel(cwdOverride);
	return (
		<SessionDropZoneView className={className} {...model}>
			{children}
		</SessionDropZoneView>
	);
}

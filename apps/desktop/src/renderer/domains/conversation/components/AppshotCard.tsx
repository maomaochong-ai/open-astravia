import { AppshotCardView } from "@vetta/theme-ui/chat";
import { useAppshotCardModel } from "../hooks/useAppshotCardModel";

/** Appshot 附件展示数据（输入框待发送 / 已发送消息共用）。 */
export interface AppshotCardData {
	imagePath: string | null;
	iconPath?: string | null;
	appName?: string;
	windowTitle?: string;
	documentPath?: string | null;
}

/**
 * Appshot 组合预览卡：截图缩略图 + 水平居中骑边的 app 图标 + 文件名。
 * 点击缩略图呼起全局图片预览；传入 onRemove 时右上角显示移除按钮（输入框待发送态用）。
 */
export function AppshotCard({ data, onRemove }: { data: AppshotCardData; onRemove?: () => void }): JSX.Element {
	const model = useAppshotCardModel(data);
	return (
		<AppshotCardView
			imageSrc={model.imageSrc}
			iconSrc={model.iconSrc}
			label={model.label}
			labels={model.labels}
			onPreview={model.onPreview}
			onRemove={onRemove}
		/>
	);
}

import type { FilePreviewContext, FilePreviewItem } from "@vetta/theme-ui/file-preview";
import {
	FilePreviewDialogView as ThemeFilePreviewDialogView,
	ThumbnailView,
} from "@vetta/theme-ui/file-preview";
import { useImageSrc } from "../hooks/useLightboxImageModel";
import { LightboxImage } from "./LightboxImage";
import { PreviewBody } from "./PreviewContent";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";

export interface FilePreviewDialogViewLabels {
	readonly close: string;
	readonly download: string;
	readonly showInFolder: string;
}

export interface FilePreviewDialogViewProps {
	readonly context: FilePreviewContext | null;
	readonly isImageGroup: boolean;
	readonly item: FilePreviewItem | null;
	readonly labels: FilePreviewDialogViewLabels;
	readonly onClose: () => void;
	readonly onDownload: (item: FilePreviewItem) => void;
	readonly onGoNext: () => void;
	readonly onGoPrev: () => void;
	readonly onSelectIndex: (index: number) => void;
	readonly onShowInFolder: (path: string) => void;
}

/**
 * Desktop adapter: resolves image src + host preview body into theme-ui shell.
 */
export function FilePreviewDialogView({
	context,
	isImageGroup,
	item,
	labels,
	onClose,
	onDownload,
	onGoNext,
	onGoPrev,
	onSelectIndex,
	onShowInFolder,
}: FilePreviewDialogViewProps): JSX.Element {
	return (
		<ThemeFilePreviewDialogView
			context={context}
			isImageGroup={isImageGroup}
			item={item}
			labels={labels}
			onClose={onClose}
			onDownload={onDownload}
			onGoNext={onGoNext}
			onGoPrev={onGoPrev}
			onSelectIndex={onSelectIndex}
			onShowInFolder={onShowInFolder}
			lightbox={
				item ? (
					<LightboxImage key={item.path ?? item.url ?? item.name} item={item} onClose={onClose} />
				) : null
			}
			previewBody={
				item ? (
					<PreviewErrorBoundary resetKey={item}>
						<PreviewBody item={item} />
					</PreviewErrorBoundary>
				) : null
			}
			thumbnails={
				isImageGroup && context ? (
					<div className="flex max-w-full gap-2 overflow-x-auto p-1.5">
						{context.items.map((it, i) => (
							<ThumbnailHost
								key={it.path ?? it.url ?? `${it.name}-${i}`}
								item={it}
								active={i === context.index}
								onClick={() => onSelectIndex(i)}
							/>
						))}
					</div>
				) : null
			}
		/>
	);
}

function ThumbnailHost({
	item,
	active,
	onClick,
}: {
	item: FilePreviewItem;
	active: boolean;
	onClick: () => void;
}): JSX.Element {
	const { src, error } = useImageSrc(item);
	return <ThumbnailView src={src} error={error} name={item.name} active={active} onClick={onClick} />;
}

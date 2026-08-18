import type { ReactNode } from "react";
import { PreviewErrorBoundary as ThemePreviewErrorBoundary } from "@vetta/theme-ui/file-preview";

interface Props {
	resetKey?: unknown;
	children: ReactNode;
	fallback?: ReactNode;
}

/** Desktop adapter: injects existing Chinese fallback copy. */
export function PreviewErrorBoundary({ resetKey, children, fallback }: Props): JSX.Element {
	return (
		<ThemePreviewErrorBoundary
			resetKey={resetKey}
			fallback={fallback}
			errorMessage="预览失败，文件可能已损坏或格式不受支持"
		>
			{children}
		</ThemePreviewErrorBoundary>
	);
}

import type { JSX, ReactNode, Ref } from "react";

export interface ExportMessageListViewProps {
	children: ReactNode;
	listRef?: Ref<HTMLDivElement>;
}

export function ExportMessageListView({
	children,
	listRef,
}: ExportMessageListViewProps): JSX.Element {
	return (
		<div
			ref={listRef}
			className="chat-export-document mx-auto flex w-full max-w-3xl flex-col px-5 py-5"
		>
			{children}
		</div>
	);
}

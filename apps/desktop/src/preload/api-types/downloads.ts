export type DownloadStatus = "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";

export interface DownloadItem {
	id: string;
	url: string;
	filename: string;
	path: string;
	totalBytes: number;
	receivedBytes: number;
	status: DownloadStatus;
	error?: string;
	createdAt: number;
	completedAt?: number;
	speedBytesPerSec?: number;
}

export interface DownloadStartParams {
	url: string;
	filename?: string;
	headers?: Record<string, string>;
	saveDir?: string;
}

export interface DownloadEvent {
	type: "added" | "updated" | "removed";
	item?: DownloadItem;
	id?: string;
}

export interface DesktopDownloadsApi {
	start(params: DownloadStartParams): Promise<DownloadItem>;
	pause(id: string): Promise<void>;
	resume(id: string): Promise<void>;
	cancel(id: string): Promise<void>;
	remove(id: string, deleteFile: boolean): Promise<void>;
	list(): Promise<DownloadItem[]>;
	openFile(id: string): Promise<void>;
	showInFolder(id: string): Promise<void>;
	getDefaultDir(): Promise<string>;
	onEvent(handler: (event: DownloadEvent) => void): () => void;
}

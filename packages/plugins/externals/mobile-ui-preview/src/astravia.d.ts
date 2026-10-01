// 可信插件直连宿主 window.astravia（ADR-0023 信任模型）的最小类型声明，
// 仅声明本插件用到的 fs 子集，与 desktop-app preload/fs-types.ts 保持一致。

interface AstraviaFsFileRef {
	name: string;
	path: string;
	relPath: string;
}

interface AstraviaFsApi {
	listFilesRecursive(rootPath: string): Promise<AstraviaFsFileRef[]>;
	watchDir(dirPath: string): Promise<void>;
	unwatchDir(dirPath: string): Promise<void>;
	onDirChanged(handler: (dirPath: string) => void): () => void;
}

interface AstraviaWindowApi {
	captureRegion(
		rect: { x: number; y: number; width: number; height: number },
		defaultFileName: string,
	): Promise<string | null>;
}

interface Window {
	astravia: {
		fs: AstraviaFsApi;
		window: AstraviaWindowApi;
	};
}

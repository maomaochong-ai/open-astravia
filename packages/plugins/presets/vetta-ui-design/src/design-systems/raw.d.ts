// vite/client 不给 `?raw` 后缀模块出类型，这里补上（css/md 全走文本导入）。
declare module "*?raw" {
	const content: string;
	export default content;
}

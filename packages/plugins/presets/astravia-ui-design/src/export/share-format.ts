/**
 * 分享包的扩展名。
 *
 * 工作态从 v2 起是 `x.astd/` **目录**（ADR-0066），分享包仍是单个 zip 文件，
 * 两者不能再共用 `.astd`：同一个扩展名一半是目录一半是文件，文件树、系统关联和
 * 「双击会发生什么」全都说不清。历史上导出的 `-share.astd` 仍能被导入（读取端按
 * 内容嗅探，见 AstdPreview）。
 */
export const SHARE_EXTENSION = "astdz";

/** 能被当作分享包打开的扩展名：新的 `.astdz`，以及历史导出的 `.astd` zip 与 0.1.0 的 `.vetdz`/`.vetd`。 */
export const SHARE_PREVIEW_EXTENSIONS = [SHARE_EXTENSION, "vetdz", "astd", "vetd"] as const;

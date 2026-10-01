/**
 * 分享包的扩展名。
 *
 * 工作态从 v2 起是 `x.astravia-design/` **目录**（ADR-0066），分享包仍是单个 zip 文件，
 * 两者不能再共用 `.astravia-design`：同一个扩展名一半是目录一半是文件，文件树、系统关联和
 * 「双击会发生什么」全都说不清。历史上导出的 `-share.astravia-design` 仍能被导入（读取端按
 * 内容嗅探，见 AstraviaDesignPreview）。
 */
export const SHARE_EXTENSION = "astravia-designz";

/** 能被当作分享包打开的扩展名：新的 `.astravia-design-share`，以及历史导出的 `.astravia-design` zip。 */
export const SHARE_PREVIEW_EXTENSIONS = [SHARE_EXTENSION, "astravia-design"] as const;

export function resolveBuildResourceFilters(families) {
	// 应用图标：设置里选中的场景图标要在运行时从 resources/build/app-icons 读取。
	const filters = new Set(["pet/**/*", "app-icons/**/*"]);
	if (families.has("darwin")) {
		filters.add("icon.icns");
		filters.add("icon.png");
		filters.add("icon-dock.png");
	}
	if (families.has("linux")) {
		filters.add("icon.png");
	}
	if (families.has("win32")) {
		filters.add("icon.ico");
		// file-transfer.ts 使用 PNG 作为可缩放的原生拖拽图标。
		filters.add("icon.png");
	}
	return [...filters];
}

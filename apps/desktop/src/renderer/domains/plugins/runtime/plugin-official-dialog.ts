import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialDialogApi(assertOfficial: () => void): PluginOfficialApi["dialog"] {
	return {
		saveCopy: (sourcePath, options) => {
			assertOfficial();
			return window.vetta.dialog.saveCopy(sourcePath, options);
		},
		openFiles: (options) => {
			assertOfficial();
			// 只回内容不回授权：插件依旧读不到项目外的任何东西，能看到的仅限用户在这次
			// 对话框里亲手选中的那几个文件。
			return window.vetta.dialog.openFileContents(options);
		},
	};
}

interface FolderIconPair {
	closed: string;
	opened: string;
}

const FILE_NAME_ICONS: Record<string, string> = {
	"package.json": "icon-[vscode-icons--file-type-node]",
	"package-lock.json": "icon-[vscode-icons--file-type-npm]",
	"npm-shrinkwrap.json": "icon-[vscode-icons--file-type-npm]",
	"yarn.lock": "icon-[vscode-icons--file-type-yarn]",
	"pnpm-lock.yaml": "icon-[vscode-icons--file-type-pnpm]",
	"bun.lock": "icon-[vscode-icons--file-type-bun]",
	"bun.lockb": "icon-[vscode-icons--file-type-bun]",
	"deno.json": "icon-[vscode-icons--file-type-deno]",
	"deno.jsonc": "icon-[vscode-icons--file-type-deno]",
	"tsconfig.json": "icon-[vscode-icons--file-type-typescript]",
	"jsconfig.json": "icon-[vscode-icons--file-type-jsconfig]",
	"vite.config.ts": "icon-[vscode-icons--file-type-vite]",
	"vite.config.js": "icon-[vscode-icons--file-type-vite]",
	"vitest.config.ts": "icon-[vscode-icons--file-type-vitest]",
	"vitest.config.js": "icon-[vscode-icons--file-type-vitest]",
	"tailwind.config.ts": "icon-[vscode-icons--file-type-tailwind]",
	"tailwind.config.js": "icon-[vscode-icons--file-type-tailwind]",
	"eslint.config.ts": "icon-[vscode-icons--file-type-eslint]",
	"eslint.config.js": "icon-[vscode-icons--file-type-eslint]",
	".eslintrc": "icon-[vscode-icons--file-type-eslint]",
	".eslintrc.json": "icon-[vscode-icons--file-type-eslint]",
	".prettierrc": "icon-[vscode-icons--file-type-prettier]",
	".prettierrc.json": "icon-[vscode-icons--file-type-prettier]",
	"prettier.config.js": "icon-[vscode-icons--file-type-prettier]",
	"biome.json": "icon-[vscode-icons--file-type-biome]",
	"biome.jsonc": "icon-[vscode-icons--file-type-biome]",
	dockerfile: "icon-[vscode-icons--file-type-docker]",
	"docker-compose.yml": "icon-[vscode-icons--file-type-docker]",
	"docker-compose.yaml": "icon-[vscode-icons--file-type-docker]",
	"compose.yml": "icon-[vscode-icons--file-type-docker]",
	"compose.yaml": "icon-[vscode-icons--file-type-docker]",
	makefile: "icon-[vscode-icons--file-type-config]",
	"cmakelists.txt": "icon-[vscode-icons--file-type-cmake]",
	"cargo.toml": "icon-[vscode-icons--file-type-cargo]",
	"cargo.lock": "icon-[vscode-icons--file-type-cargo]",
	"go.mod": "icon-[vscode-icons--file-type-go]",
	"go.sum": "icon-[vscode-icons--file-type-go]",
	"go.work": "icon-[vscode-icons--file-type-go-work]",
	"pyproject.toml": "icon-[vscode-icons--file-type-python]",
	"requirements.txt": "icon-[vscode-icons--file-type-python]",
	"poetry.lock": "icon-[vscode-icons--file-type-poetry]",
	gemfile: "icon-[vscode-icons--file-type-ruby]",
	"composer.json": "icon-[vscode-icons--file-type-php]",
	"pom.xml": "icon-[vscode-icons--file-type-java]",
	"build.gradle": "icon-[vscode-icons--file-type-gradle]",
	"build.gradle.kts": "icon-[vscode-icons--file-type-gradle]",
	".gitignore": "icon-[vscode-icons--file-type-git]",
	".gitattributes": "icon-[vscode-icons--file-type-git]",
	".gitmodules": "icon-[vscode-icons--file-type-git]",
	"agents.md": "icon-[vscode-icons--file-type-agents]",
	license: "icon-[vscode-icons--file-type-license]",
	"license.md": "icon-[vscode-icons--file-type-license]",
	"license.txt": "icon-[vscode-icons--file-type-license]",
	readme: "icon-[vscode-icons--file-type-markdown]",
	"readme.md": "icon-[vscode-icons--file-type-markdown]",
	changelog: "icon-[vscode-icons--file-type-markdown]",
	"changelog.md": "icon-[vscode-icons--file-type-markdown]",
};

const COMPOUND_SUFFIX_ICONS: ReadonlyArray<readonly [string, string]> = [
	[".stories.tsx", "icon-[vscode-icons--file-type-storybook]"],
	[".stories.jsx", "icon-[vscode-icons--file-type-storybook]"],
	[".stories.ts", "icon-[vscode-icons--file-type-storybook]"],
	[".stories.js", "icon-[vscode-icons--file-type-storybook]"],
	[".test.tsx", "icon-[vscode-icons--file-type-testts]"],
	[".spec.tsx", "icon-[vscode-icons--file-type-testts]"],
	[".test.ts", "icon-[vscode-icons--file-type-testts]"],
	[".spec.ts", "icon-[vscode-icons--file-type-testts]"],
	[".test.jsx", "icon-[vscode-icons--file-type-testjs]"],
	[".spec.jsx", "icon-[vscode-icons--file-type-testjs]"],
	[".test.js", "icon-[vscode-icons--file-type-testjs]"],
	[".spec.js", "icon-[vscode-icons--file-type-testjs]"],
	[".d.ts", "icon-[vscode-icons--file-type-typescriptdef]"],
	[".config.ts", "icon-[vscode-icons--file-type-config]"],
	[".config.js", "icon-[vscode-icons--file-type-config]"],
];

const EXTENSION_ICONS: Record<string, string> = {
	ts: "icon-[vscode-icons--file-type-typescript]",
	mts: "icon-[vscode-icons--file-type-typescript]",
	cts: "icon-[vscode-icons--file-type-typescript]",
	tsx: "icon-[vscode-icons--file-type-reactts]",
	js: "icon-[vscode-icons--file-type-js-official]",
	mjs: "icon-[vscode-icons--file-type-js-official]",
	cjs: "icon-[vscode-icons--file-type-js-official]",
	jsx: "icon-[vscode-icons--file-type-reactjs]",
	vue: "icon-[vscode-icons--file-type-vue]",
	svelte: "icon-[vscode-icons--file-type-svelte]",
	astro: "icon-[vscode-icons--file-type-astro]",
	html: "icon-[vscode-icons--file-type-html]",
	htm: "icon-[vscode-icons--file-type-html]",
	css: "icon-[vscode-icons--file-type-css]",
	scss: "icon-[vscode-icons--file-type-scss2]",
	sass: "icon-[vscode-icons--file-type-sass]",
	less: "icon-[vscode-icons--file-type-less]",
	styl: "icon-[vscode-icons--file-type-stylus]",
	json: "icon-[vscode-icons--file-type-json]",
	jsonc: "icon-[vscode-icons--file-type-json]",
	json5: "icon-[vscode-icons--file-type-json5]",
	yaml: "icon-[vscode-icons--file-type-yaml]",
	yml: "icon-[vscode-icons--file-type-yaml]",
	toml: "icon-[vscode-icons--file-type-toml]",
	xml: "icon-[vscode-icons--file-type-xml]",
	ini: "icon-[vscode-icons--file-type-ini]",
	env: "icon-[vscode-icons--file-type-dotenv]",
	py: "icon-[vscode-icons--file-type-python]",
	pyw: "icon-[vscode-icons--file-type-python]",
	go: "icon-[vscode-icons--file-type-go]",
	rs: "icon-[vscode-icons--file-type-rust]",
	java: "icon-[vscode-icons--file-type-java]",
	kt: "icon-[vscode-icons--file-type-kotlin]",
	kts: "icon-[vscode-icons--file-type-kotlin]",
	swift: "icon-[vscode-icons--file-type-swift]",
	rb: "icon-[vscode-icons--file-type-ruby]",
	php: "icon-[vscode-icons--file-type-php]",
	c: "icon-[vscode-icons--file-type-c]",
	h: "icon-[vscode-icons--file-type-cppheader]",
	cc: "icon-[vscode-icons--file-type-cpp]",
	cpp: "icon-[vscode-icons--file-type-cpp]",
	cxx: "icon-[vscode-icons--file-type-cpp]",
	hpp: "icon-[vscode-icons--file-type-cppheader]",
	cs: "icon-[vscode-icons--file-type-csharp]",
	fs: "icon-[vscode-icons--file-type-fsharp]",
	fsx: "icon-[vscode-icons--file-type-fsharp]",
	dart: "icon-[vscode-icons--file-type-dartlang]",
	lua: "icon-[vscode-icons--file-type-lua]",
	r: "icon-[vscode-icons--file-type-r]",
	scala: "icon-[vscode-icons--file-type-scala]",
	ex: "icon-[vscode-icons--file-type-elixir]",
	exs: "icon-[vscode-icons--file-type-elixir]",
	erl: "icon-[vscode-icons--file-type-erlang]",
	clj: "icon-[vscode-icons--file-type-clojure]",
	cljs: "icon-[vscode-icons--file-type-clojurescript]",
	hs: "icon-[vscode-icons--file-type-haskell]",
	sol: "icon-[vscode-icons--file-type-solidity]",
	zig: "icon-[vscode-icons--file-type-zig]",
	proto: "icon-[vscode-icons--file-type-protobuf]",
	graphql: "icon-[vscode-icons--file-type-graphql]",
	gql: "icon-[vscode-icons--file-type-graphql]",
	sql: "icon-[vscode-icons--file-type-sql]",
	sqlite: "icon-[vscode-icons--file-type-sqlite]",
	db: "icon-[vscode-icons--file-type-sqlite]",
	md: "icon-[vscode-icons--file-type-markdown]",
	mdx: "icon-[vscode-icons--file-type-markdown]",
	txt: "icon-[vscode-icons--file-type-text]",
	log: "icon-[vscode-icons--file-type-log]",
	pdf: "icon-[vscode-icons--file-type-pdf2]",
	doc: "icon-[vscode-icons--file-type-word]",
	docx: "icon-[vscode-icons--file-type-word]",
	xls: "icon-[vscode-icons--file-type-excel]",
	xlsx: "icon-[vscode-icons--file-type-excel]",
	csv: "icon-[vscode-icons--file-type-excel]",
	ppt: "icon-[vscode-icons--file-type-powerpoint]",
	pptx: "icon-[vscode-icons--file-type-powerpoint]",
	png: "icon-[vscode-icons--file-type-image]",
	jpg: "icon-[vscode-icons--file-type-image]",
	jpeg: "icon-[vscode-icons--file-type-image]",
	gif: "icon-[vscode-icons--file-type-image]",
	webp: "icon-[vscode-icons--file-type-image]",
	avif: "icon-[vscode-icons--file-type-avif]",
	ico: "icon-[vscode-icons--file-type-image]",
	svg: "icon-[vscode-icons--file-type-svg]",
	mp3: "icon-[vscode-icons--file-type-audio]",
	wav: "icon-[vscode-icons--file-type-audio]",
	m4a: "icon-[vscode-icons--file-type-audio]",
	flac: "icon-[vscode-icons--file-type-audio]",
	mp4: "icon-[vscode-icons--file-type-video]",
	mov: "icon-[vscode-icons--file-type-video]",
	webm: "icon-[vscode-icons--file-type-video]",
	zip: "icon-[vscode-icons--file-type-zip]",
	"7z": "icon-[vscode-icons--file-type-zip]",
	gz: "icon-[vscode-icons--file-type-zip]",
	tgz: "icon-[vscode-icons--file-type-zip]",
	tar: "icon-[vscode-icons--file-type-zip]",
	rar: "icon-[vscode-icons--file-type-zip]",
	wasm: "icon-[vscode-icons--file-type-wasm]",
	bin: "icon-[vscode-icons--file-type-binary]",
	sh: "icon-[vscode-icons--file-type-shell]",
	bash: "icon-[vscode-icons--file-type-shell]",
	zsh: "icon-[vscode-icons--file-type-shell]",
	ps1: "icon-[vscode-icons--file-type-powershell]",
	bat: "icon-[vscode-icons--file-type-bat]",
	cmd: "icon-[vscode-icons--file-type-bat]",
	lock: "icon-[vscode-icons--file-type-config]",
};

const FOLDER_ICONS: Record<string, FolderIconPair> = {
	src: { closed: "icon-[vscode-icons--folder-type-src]", opened: "icon-[vscode-icons--folder-type-src-opened]" },
	source: { closed: "icon-[vscode-icons--folder-type-src]", opened: "icon-[vscode-icons--folder-type-src-opened]" },
	components: {
		closed: "icon-[vscode-icons--folder-type-component]",
		opened: "icon-[vscode-icons--folder-type-component-opened]",
	},
	hooks: { closed: "icon-[vscode-icons--folder-type-hook]", opened: "icon-[vscode-icons--folder-type-hook-opened]" },
	test: { closed: "icon-[vscode-icons--folder-type-test]", opened: "icon-[vscode-icons--folder-type-test-opened]" },
	tests: { closed: "icon-[vscode-icons--folder-type-test]", opened: "icon-[vscode-icons--folder-type-test-opened]" },
	__tests__: {
		closed: "icon-[vscode-icons--folder-type-test]",
		opened: "icon-[vscode-icons--folder-type-test-opened]",
	},
	assets: {
		closed: "icon-[vscode-icons--folder-type-asset]",
		opened: "icon-[vscode-icons--folder-type-asset-opened]",
	},
	images: {
		closed: "icon-[vscode-icons--folder-type-images]",
		opened: "icon-[vscode-icons--folder-type-images-opened]",
	},
	icons: {
		closed: "icon-[vscode-icons--folder-type-images]",
		opened: "icon-[vscode-icons--folder-type-images-opened]",
	},
	docs: { closed: "icon-[vscode-icons--folder-type-docs]", opened: "icon-[vscode-icons--folder-type-docs-opened]" },
	documentation: {
		closed: "icon-[vscode-icons--folder-type-docs]",
		opened: "icon-[vscode-icons--folder-type-docs-opened]",
	},
	node_modules: {
		closed: "icon-[vscode-icons--folder-type-node]",
		opened: "icon-[vscode-icons--folder-type-node-opened]",
	},
	packages: {
		closed: "icon-[vscode-icons--folder-type-package]",
		opened: "icon-[vscode-icons--folder-type-package-opened]",
	},
	lib: {
		closed: "icon-[vscode-icons--folder-type-library]",
		opened: "icon-[vscode-icons--folder-type-library-opened]",
	},
	config: {
		closed: "icon-[vscode-icons--folder-type-config]",
		opened: "icon-[vscode-icons--folder-type-config-opened]",
	},
	api: { closed: "icon-[vscode-icons--folder-type-api]", opened: "icon-[vscode-icons--folder-type-api-opened]" },
	server: {
		closed: "icon-[vscode-icons--folder-type-server]",
		opened: "icon-[vscode-icons--folder-type-server-opened]",
	},
	backend: {
		closed: "icon-[vscode-icons--folder-type-server]",
		opened: "icon-[vscode-icons--folder-type-server-opened]",
	},
	client: {
		closed: "icon-[vscode-icons--folder-type-client]",
		opened: "icon-[vscode-icons--folder-type-client-opened]",
	},
	frontend: {
		closed: "icon-[vscode-icons--folder-type-client]",
		opened: "icon-[vscode-icons--folder-type-client-opened]",
	},
	db: { closed: "icon-[vscode-icons--folder-type-db]", opened: "icon-[vscode-icons--folder-type-db-opened]" },
	database: { closed: "icon-[vscode-icons--folder-type-db]", opened: "icon-[vscode-icons--folder-type-db-opened]" },
	scripts: {
		closed: "icon-[vscode-icons--folder-type-script]",
		opened: "icon-[vscode-icons--folder-type-script-opened]",
	},
	styles: {
		closed: "icon-[vscode-icons--folder-type-style]",
		opened: "icon-[vscode-icons--folder-type-style-opened]",
	},
	templates: {
		closed: "icon-[vscode-icons--folder-type-template]",
		opened: "icon-[vscode-icons--folder-type-template-opened]",
	},
	public: {
		closed: "icon-[vscode-icons--folder-type-public]",
		opened: "icon-[vscode-icons--folder-type-public-opened]",
	},
	dist: { closed: "icon-[vscode-icons--folder-type-dist]", opened: "icon-[vscode-icons--folder-type-dist-opened]" },
	build: { closed: "icon-[vscode-icons--folder-type-dist]", opened: "icon-[vscode-icons--folder-type-dist-opened]" },
	coverage: {
		closed: "icon-[vscode-icons--folder-type-coverage]",
		opened: "icon-[vscode-icons--folder-type-coverage-opened]",
	},
	".github": {
		closed: "icon-[vscode-icons--folder-type-github]",
		opened: "icon-[vscode-icons--folder-type-github-opened]",
	},
	".git": { closed: "icon-[vscode-icons--folder-type-git]", opened: "icon-[vscode-icons--folder-type-git-opened]" },
	".vscode": {
		closed: "icon-[vscode-icons--folder-type-vscode]",
		opened: "icon-[vscode-icons--folder-type-vscode-opened]",
	},
	docker: {
		closed: "icon-[vscode-icons--folder-type-docker]",
		opened: "icon-[vscode-icons--folder-type-docker-opened]",
	},
	audio: { closed: "icon-[vscode-icons--folder-type-audio]", opened: "icon-[vscode-icons--folder-type-audio-opened]" },
	video: { closed: "icon-[vscode-icons--folder-type-video]", opened: "icon-[vscode-icons--folder-type-video-opened]" },
};

function resolveFileIcon(name: string): string {
	const normalizedName = name.toLowerCase();
	if (normalizedName === ".env" || normalizedName.startsWith(".env.")) {
		return "icon-[vscode-icons--file-type-dotenv]";
	}
	if (normalizedName.startsWith("dockerfile.")) return "icon-[vscode-icons--file-type-docker]";
	const filenameIcon = FILE_NAME_ICONS[normalizedName];
	if (filenameIcon) return filenameIcon;
	for (const [suffix, icon] of COMPOUND_SUFFIX_ICONS) {
		if (normalizedName.endsWith(suffix)) return icon;
	}
	const dotIndex = normalizedName.lastIndexOf(".");
	if (dotIndex >= 0) {
		const extensionIcon = EXTENSION_ICONS[normalizedName.slice(dotIndex + 1)];
		if (extensionIcon) return extensionIcon;
	}
	return "icon-[vscode-icons--default-file]";
}

export function getFileIcon(name: string, isDirectory: boolean, isExpanded = false): string {
	if (!isDirectory) return resolveFileIcon(name);
	const folderIcon = FOLDER_ICONS[name.toLowerCase()];
	if (folderIcon) return isExpanded ? folderIcon.opened : folderIcon.closed;
	return isExpanded ? "icon-[vscode-icons--default-folder-opened]" : "icon-[vscode-icons--default-folder]";
}

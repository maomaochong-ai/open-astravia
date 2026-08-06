export interface ModelsConfigData {
	/** Default model identifier: "provider/modelId" */
	defaultModel?: string;
	providers: Record<
		string,
		{
			baseUrl?: string;
			/** `get` 仅返回 `***` 或外部引用；实际密钥只允许在 `set` 时短暂传入。 */
			apiKey?: string;
			/** 主进程凭据库中的不透明引用；renderer 只需原样保留。 */
			credentialRef?: string;
			api?: string;
			headers?: Record<string, string>;
			authHeader?: boolean;
			/** 供应商显示名(如 "DeepSeek"),用于 UI 分组标题等;无则回退到 provider 标识 key。 */
			displayName?: string;
			/** 来源标记。"template" = 由[[预设服务商]]填 key 采纳而来,模型列表会被定时同步覆写;无标记 = 手搓自定义,任何同步逻辑都不得触碰。 */
			source?: "template";
			/** 对应服务端模板的 provider 标识(= 模板 provider key),仅 source==="template" 时存在。 */
			templateId?: string;
			/** 供应商图标 symbol(见 CONTEXT.md「icon symbol」),客户端按此解析内置图标。可选。 */
			icon?: string;
			/** 预设服务商模型列表最近一次从上游 /models 同步的时间(ISO)。 */
			modelsSyncedAt?: string;
			models?: Array<{
				id: string;
				/** 上游 API 真实模型名。远程渠道下 id=网关路由 key、modelId=上游真名；缺省回退 id。 */
				modelId?: string;
				name?: string;
				api?: string;
				reasoning?: boolean;
				reasoningLevels?: string[];
				defaultReasoningLevel?: string;
				input?: string[];
				contextWindow?: number;
				maxTokens?: number;
				/** 价格($/百万 tokens):input=输入未命中, cacheRead=输入命中, output=输出, cacheWrite=缓存写入。 */
				cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
			}>;
			modelOverrides?: Record<string, Record<string, unknown>>;
		}
	>;
}

export interface RemoteProvidersResult {
	providers: Record<string, unknown>;
	error?: string;
}

/** 单个[[预设服务商]]:客户端内置目录条目,不含 key。 */
export interface PresetProviderInfo {
	/** 预设标识(= provider key),持久化时写入 templateId。 */
	id: string;
	displayName: string;
	api: string;
	baseUrl: string;
	/** 供应商图标 symbol。 */
	icon: string;
	/** 公共目录(models.dev)里该家的模型,免 key 可见;填 key 后由账号实际可用的列表取代。 */
	catalogModels: NonNullable<ModelsConfigData["providers"][string]["models"]>;
}

export interface PresetProvidersResult {
	providers: PresetProviderInfo[];
	/** 公共目录最近一次拉取失败的原因。仅在退到随包快照时给出。 */
	catalogError?: PresetError;
	/** 当前目录数据来自哪里:实拉/缓存 = live,随包内置快照 = snapshot。 */
	catalogSource: "live" | "snapshot";
	/** 当前目录数据的抓取时间(ISO)。 */
	catalogFetchedAt?: string;
}

/** 预设链路的结构化错误码。文案由渲染层查 i18n,主进程不产出面向用户的中文。 */
export type PresetErrorCode =
	| "unknown-provider"
	| "missing-key"
	| "invalid-key"
	| "http-status"
	| "empty-models"
	| "timeout"
	| "network";

export interface PresetError {
	code: PresetErrorCode;
	params?: Record<string, string | number>;
	/** 未翻译的原始错误信息,仅用于排查。 */
	detail?: string;
}

export interface PresetModelsResult {
	models: NonNullable<ModelsConfigData["providers"][string]["models"]>;
	error?: PresetError;
}

export interface DesktopModelsApi {
	get(): Promise<ModelsConfigData>;
	set(config: ModelsConfigData): Promise<void>;
	/** 主进程直接写入剪贴板；密钥明文不会作为 IPC 结果返回 renderer。 */
	copyApiKey(providerId: string): Promise<boolean>;
	fetchRemote(): Promise<RemoteProvidersResult>;
	/** 读取客户端内置的[[预设服务商]]目录(无网络请求)。 */
	listPresets(): Promise<PresetProvidersResult>;
	/** 按 key 拉取某预设服务商上游 `/models` 的模型列表。只拉不写,由调用方落盘。 */
	refreshPresetModels(providerId: string, apiKey?: string): Promise<PresetModelsResult>;
	/** 手动刷新 models.dev 公共目录(清掉失败冷却强制重拉),失败时返回可读的错误原文。 */
	refreshPresetCatalog(): Promise<{ ok: boolean; error?: PresetError; elapsedMs: number; modelCount: number }>;
	/** 公共目录后台刷新到新数据时触发,收到后重新 listPresets 即可。返回取消订阅函数。 */
	onPresetsUpdated(handler: () => void): () => void;
	/** 探测某 (provider, model) 的 baseUrl 是否可达(本地 models.json 优先,回退云端目录)。仅判可达性,任何 HTTP 响应都算通。 */
	probe(ref: { provider: string; model: string }): Promise<{ ok: boolean; message?: string; error?: string }>;
	/** 拉取本地自定义 provider 的 `GET {baseUrl}/models`,返回上游模型 id 列表,用于快速填写模型配置。 */
	fetchProviderModels(providerName: string): Promise<{ models: string[]; error?: string }>;
}

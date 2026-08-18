/**
 * 把 provider / 网关吐出来的原始错误串归成有限几类，供消息流里的错误卡选择
 * 图标、人话文案与恢复动作。
 *
 * 与 coding-agent `src/core/session/retry-controller.ts:57-81` 的关系：那边判
 * 「要不要自动重试」，这边判「怎么跟用户措辞」，两套正则**故意不共享**——重试
 * 策略和文案分类的演进方向不同，绑死会让改文案时动到重试行为。代价是两边可能
 * 漂移，所以 classifyChatError.test.ts 用同一组真实样本锁住二者不矛盾：
 * quota 必不可重试，rate_limit / server / network 必可重试。改任一侧的正则前
 * 先跑那个测试。
 */
export type ChatErrorKind = "rate_limit" | "quota" | "network" | "auth" | "server" | "unknown";

/**
 * 配额 / 余额耗尽。重置时间通常在数小时后，重试无意义，只能等或充值。
 * 关键词与 retry-controller 的「非重试」名单对齐。
 */
const QUOTA =
	/额度已用尽|额度不足|窗口额度|余额不足|Token Plan|insufficient.?quota|insufficient.?balance|quota.?exhausted|quota.?exceeded|out of quota|exceeded your current quota|billing|payment required|402/i;

/** 鉴权失败：密钥无效 / 过期 / 无权限。 */
const AUTH =
	/\b401\b|\b403\b|unauthorized|forbidden|invalid.?api.?key|invalid.?x-api-key|authentication.?(error|failed)|permission.?denied|no api key found|api key not|未登录|登录已过期|密钥无效/i;

/** 限流：请求太密，等一会儿就好。 */
const RATE_LIMIT = /\b429\b|rate.?limit|too many requests|overloaded|请求过于频繁/i;

/** 服务端故障：网关或上游 5xx。 */
const SERVER =
	/\b5\d{2}\b|service.?unavailable|server error|internal error|bad gateway|upstream.?connect|gateway.?timeout/i;

/** 本地网络够不着服务：连不上、断流、超时。 */
const NETWORK =
	/fetch failed|connection.?(error|refused|reset|closed)|other side closed|reset before headers|socket hang up|network.?error|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|terminated|timed? ?out|超时/i;

/**
 * 归类一条错误文本。
 *
 * 顺序即优先级，按「用户能做什么」从确定到模糊排：配额和鉴权要人工介入，必须
 * 先于泛化的限流 / 5xx 命中（网关把配额耗尽也报成 429，只看状态码会误判成
 * 「等等就好」）。server 早于 network：`upstream connect error` 一类同时含连接
 * 词和上游语义，归到服务端更接近真相。
 */
export function classifyChatError(text: string): ChatErrorKind {
	if (!text) return "unknown";
	if (QUOTA.test(text)) return "quota";
	if (AUTH.test(text)) return "auth";
	if (RATE_LIMIT.test(text)) return "rate_limit";
	if (SERVER.test(text)) return "server";
	if (NETWORK.test(text)) return "network";
	return "unknown";
}

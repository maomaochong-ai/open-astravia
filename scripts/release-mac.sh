#!/usr/bin/env bash
#
# macOS 桌面端构建 + 发布的一键脚本，三个通道：
#
#   scripts/release-mac.sh local  --version 0.5.62   # 本地闭环，跳公证、不碰 R2
#   scripts/release-mac.sh test   --version 0.5.60   # QA 通道
#   scripts/release-mac.sh stable                    # 正式通道
#
# 可选参数：
#   --arch arm64|x64|both   默认 arm64。both 会分两次构建并合并元数据。
#   --check-only            只跑前置校验就退出，不清 release/、不构建。
#   --skip-publish          只构建与校验，不上传。
#   --yes                   跳过 stable 的二次确认。
#
# local 通道用于快速验证更新链路本身：保留签名（Squirrel.Mac 必需）但跳过公证，
# 省掉每轮 10~30 分钟的 Apple 排队；产物落到 ~/.vetta/local-updates 并由
# `bun run serve:updates:local` 分发。多个版本会累积在该目录——差分下载需要读
# **旧版本**的 blockmap。未公证产物不可分发，test/stable 的发布门禁会用
# `stapler validate` 挡住它们。
#
# 凭据来自两个文件，都不进仓库：
#   ~/.config/vetta/mac-signing.env    签名与公证（通道无关）
#   ~/.config/vetta/r2-<channel>.env   R2 凭据与通道配置（local 通道不需要）
#
# 构建期的 VETTA_UPDATE_PROVIDER / VETTA_UPDATE_URL 由本脚本直接注入，
# 因此不依赖 packages/desktop-app/.env.development 里有没有配这两项。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="${REPO_ROOT}/packages/desktop-app"
SIGNING_ENV="${HOME}/.config/vetta/mac-signing.env"
# 一切都以脚本自身位置为准，不依赖调用者的 cwd。
cd "${REPO_ROOT}"

CHANNEL=""
VERSION=""
ARCH="arm64"
CHECK_ONLY=0
SKIP_PUBLISH=0
ASSUME_YES=0

die() {
	echo "[release-mac] $*" >&2
	exit 1
}

step() {
	echo
	echo "==> $*"
}

usage() {
	sed -n '3,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
	exit 1
}

# ── 参数 ──────────────────────────────────────────────────────────────────────

[[ $# -ge 1 ]] || usage
CHANNEL="$1"
shift
[[ "${CHANNEL}" == "local" || "${CHANNEL}" == "test" || "${CHANNEL}" == "stable" ]] || usage

while [[ $# -gt 0 ]]; do
	case "$1" in
		--version)
			[[ $# -ge 2 ]] || die "--version 缺少值"
			VERSION="$2"
			shift 2
			;;
		--arch)
			[[ $# -ge 2 ]] || die "--arch 缺少值"
			ARCH="$2"
			shift 2
			;;
		--check-only)
			CHECK_ONLY=1
			shift
			;;
		--skip-publish)
			SKIP_PUBLISH=1
			shift
			;;
		--yes)
			ASSUME_YES=1
			shift
			;;
		*) usage ;;
	esac
done

case "${ARCH}" in
	arm64 | x64 | both) ;;
	*) die "--arch 只能是 arm64、x64 或 both" ;;
esac

# ── 凭据 ──────────────────────────────────────────────────────────────────────

LOCAL_UPDATE_DIR="${VETTA_LOCAL_UPDATE_DIR:-${HOME}/.vetta/local-updates}"
LOCAL_UPDATE_PORT="${VETTA_LOCAL_UPDATE_PORT:-8080}"

[[ -f "${SIGNING_ENV}" ]] || die "找不到签名凭据 ${SIGNING_ENV}（见 docs/deploy/apple-code-signing.md）"
# shellcheck source=/dev/null
source "${SIGNING_ENV}"

if [[ "${CHANNEL}" == "local" ]]; then
	# 本地通道不碰 R2，也不需要通道凭据文件；跳过公证换取迭代速度。
	export VETTA_SKIP_NOTARIZE=1
	export VETTA_UPDATE_URL="http://127.0.0.1:${LOCAL_UPDATE_PORT}"
	unset VETTA_REQUIRE_MAC_SIGNATURE
else
	CHANNEL_ENV="${HOME}/.config/vetta/r2-${CHANNEL}.env"
	[[ -f "${CHANNEL_ENV}" ]] || die "找不到通道配置 ${CHANNEL_ENV}"
	# shellcheck source=/dev/null
	source "${CHANNEL_ENV}"
fi

# ── 前置校验 ──────────────────────────────────────────────────────────────────

step "前置校验"

if [[ "${CHANNEL}" != "local" ]]; then
	for name in VETTA_R2_ACCOUNT_ID VETTA_R2_ACCESS_KEY_ID VETTA_R2_SECRET_ACCESS_KEY VETTA_R2_BUCKET VETTA_R2_PREFIX VETTA_UPDATE_URL; do
		[[ -n "${!name:-}" ]] || die "${CHANNEL_ENV} 缺少 ${name}"
	done

	[[ "${VETTA_R2_PREFIX##*/}" == "${CHANNEL}" ]] ||
		die "通道不一致：VETTA_R2_PREFIX=${VETTA_R2_PREFIX} 的末段不是 ${CHANNEL}"
	[[ "${VETTA_UPDATE_URL##*/}" == "${CHANNEL}" ]] ||
		die "通道不一致：VETTA_UPDATE_URL=${VETTA_UPDATE_URL} 的末段不是 ${CHANNEL}"
fi

[[ -n "${CSC_LINK:-}${CSC_NAME:-}" ]] || die "${SIGNING_ENV} 缺少 CSC_LINK 或 CSC_NAME"
[[ -n "${APPLE_TEAM_ID:-}" ]] || die "${SIGNING_ENV} 缺少 APPLE_TEAM_ID"
# local 通道跳过公证，因此不要求公证凭据；签名仍是必需的（Squirrel.Mac 会校验）。
if [[ "${CHANNEL}" != "local" ]]; then
	if [[ -z "${APPLE_API_KEY:-}" || -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
		[[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]] ||
			die "${SIGNING_ENV} 缺少公证凭据（APPLE_API_KEY 三件套，或 APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD）"
	fi
fi

security find-identity -v -p codesigning 2>/dev/null | grep -q "valid identities found" ||
	die "钥匙串里没有可用的代码签名身份"

PACKAGE_VERSION="$(node -p "require('${DESKTOP_DIR}/package.json').version")"

if [[ "${CHANNEL}" == "stable" ]]; then
	[[ -z "${VERSION}" ]] ||
		die "stable 不接受 --version：正式版本以 package.json 为唯一真源（当前 ${PACKAGE_VERSION}）"
	VERSION="${PACKAGE_VERSION}"
else
	[[ -n "${VERSION}" ]] || die "${CHANNEL} 必须显式指定 --version，避免误发"
fi

[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本号格式非法：${VERSION}"

# 已发布版本：同名版本化对象禁止覆盖，必须严格递增。
# local 通道直接读分发目录的清单，不依赖服务是否在跑。
if [[ "${CHANNEL}" == "local" ]]; then
	ONLINE_VERSION="$(awk '/^version:/ { print $2; exit }' "${LOCAL_UPDATE_DIR}/latest-mac.yml" 2>/dev/null || true)"
else
	ONLINE_VERSION="$(
		curl -fsS --max-time 20 "${VETTA_UPDATE_URL}/latest-mac.yml?cachebust=$$" 2>/dev/null |
			awk '/^version:/ { print $2; exit }'
	)" || ONLINE_VERSION=""
fi

if [[ -n "${ONLINE_VERSION}" ]]; then
	node -e '
		const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number));
		for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) process.exit(a[i] > b[i] ? 0 : 1);
		process.exit(1);
	' "${VERSION}" "${ONLINE_VERSION}" ||
		die "${VERSION} 不高于 ${CHANNEL} 通道线上的 ${ONLINE_VERSION}；版本化对象禁止覆盖，请换号"
	echo "    ${CHANNEL} 线上 macOS 版本：${ONLINE_VERSION}"
else
	echo "    ${CHANNEL} 线上还没有 macOS 产物"
fi

echo "    通道       ${CHANNEL}  ->  ${VETTA_UPDATE_URL}"
echo "    版本       ${VERSION}$([[ "${VERSION}" != "${PACKAGE_VERSION}" ]] && echo "（package.json 是 ${PACKAGE_VERSION}，QA 覆盖）" || true)"
echo "    架构       ${ARCH}"
echo "    签名身份   ${APPLE_TEAM_ID}"
if [[ "${CHANNEL}" == "local" ]]; then
	echo "    公证       跳过（VETTA_SKIP_NOTARIZE=1，产物不可分发）"
	echo "    分发目录   ${LOCAL_UPDATE_DIR}"
fi

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
	step "前置校验通过（--check-only，未清理 release/，未构建）"
	exit 0
fi

if [[ "${CHANNEL}" == "stable" && "${SKIP_PUBLISH}" -eq 0 && "${ASSUME_YES}" -eq 0 ]]; then
	echo
	echo "即将发布到 stable 正式通道。请确认已在 test 完成真实的「旧安装版 -> CDN -> 新版本 -> 重启」闭环。"
	read -r -p "输入 ${VERSION} 继续：" confirm
	[[ "${confirm}" == "${VERSION}" ]] || die "已取消"
fi

# ── 构建 ──────────────────────────────────────────────────────────────────────

export VETTA_UPDATE_PROVIDER="generic"
export VETTA_DESKTOP_BUILD_VERSION="${VERSION}"
# local 通道的产物没有公证票据，stapler 校验必然失败，因此不打开这个门禁。
[[ "${CHANNEL}" == "local" ]] || export VETTA_REQUIRE_MAC_SIGNATURE=1

cd "${DESKTOP_DIR}"

step "清理 release/"
rm -rf release

if [[ "${ARCH}" == "both" ]]; then
	ARCH_LIST=(arm64 x64)
else
	ARCH_LIST=("${ARCH}")
fi

for arch in "${ARCH_LIST[@]}"; do
	if [[ "${CHANNEL}" == "local" ]]; then
		step "构建 ${arch}（签名，跳过公证）"
	else
		step "构建 ${arch}（签名 + 公证，通常 40~70 分钟）"
	fi
	bun run "dist:mac:${arch}"

	step "校验 ${arch} 产物"
	bun run verify:updates:mac

	if [[ "${ARCH}" == "both" ]]; then
		# 两次构建都写同名 latest-mac.yml，后一次会覆盖前一次，先按架构改名
		mv release/latest-mac.yml "release/latest-mac-${arch}.yml"
	fi
done

if [[ "${ARCH}" == "both" ]]; then
	step "合并双架构元数据"
	bun run merge:updates:mac
fi

if [[ "${SKIP_PUBLISH}" -eq 1 ]]; then
	step "已跳过发布（--skip-publish）"
	ls -lh release
	exit 0
fi

# ── 发布 ──────────────────────────────────────────────────────────────────────

if [[ "${CHANNEL}" == "local" ]]; then
	# 只覆盖清单，旧版本的 zip 与 blockmap 一律保留：差分下载要读旧版 blockmap。
	step "复制到本地分发目录 ${LOCAL_UPDATE_DIR}"
	mkdir -p "${LOCAL_UPDATE_DIR}"
	find release -maxdepth 1 -type f \( -name "*.zip" -o -name "*.blockmap" -o -name "*.dmg" -o -name "latest*.yml" \) \
		-exec cp {} "${LOCAL_UPDATE_DIR}/" \;
	ls -lh "${LOCAL_UPDATE_DIR}"

	step "完成：${VERSION} 已进入本地分发目录"
	echo
	echo "下一步："
	echo "  1. 起分发服务（另开一个终端，必须保持运行）："
	echo "       bun run --cwd packages/desktop-app serve:updates:local"
	echo "  2. 首次：装 release/ 里的 DMG 到 /Applications，然后播种差分基线："
	echo "       cp release/Vetta-${VERSION}-arm64-mac.zip ~/Library/Caches/vetta-updater/update.zip"
	echo "  3. 再构建一个更高版本，从终端启动旧版验证更新："
	echo "       /Applications/Vetta.app/Contents/MacOS/Vetta"
	echo "  详见 docs/desktop/macos-auto-update.md 第 7 节"
	exit 0
fi

step "发布到 ${VETTA_UPDATE_URL}"
bun run publish:updates:r2

step "完成：${VERSION} 已发布到 ${CHANNEL}"
echo
echo "下一步："
echo "  1. 装 release/ 里的 DMG 到 /Applications"
echo "  2. 从终端启动看日志：/Applications/Vetta.app/Contents/MacOS/Vetta"
echo "  3. 发布更高版本后验证更新闭环，重点看进度停在 90% 到 ready 之间的耗时"
echo "  详见 docs/desktop/macos-auto-update.md 第 7 节"

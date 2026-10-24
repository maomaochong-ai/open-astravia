#!/usr/bin/env bash
# 打一个可以发到官网让用户自己安装的 iOS 包。
#
# 背景：App 还没上架 App Store，手机用户仍然要能用。可行路径只有两条：
#   1. 未签名 IPA —— 用户用 Sideloadly / AltStore 之类工具用自己的 Apple ID 签名安装。
#      不需要开发者账号，代价是免费账号签出来的 App 每 7 天要重签一次。
#   2. 已签名 IPA + OTA —— 需要付费开发者账号，把设备 UDID 加进描述文件后重签，
#      用户点官网上的链接就能直接装。这条路径要 TEAM_ID 与描述文件，脚本会在
#      环境变量齐全时自动走完，并顺手产出 OTA 需要的 manifest.plist。
#
# 用法：
#   ./scripts/build-ios-ipa.sh                  # 未签名 IPA（默认，给 Sideloadly 用）
#   TEAM_ID=ABCDE12345 PROFILE_UUID=xxxx-... ./scripts/build-ios-ipa.sh
#                                               # 已签名 IPA + manifest.plist（需付费账号）
#
# 产物落在 build/ios/：Astravia-ios.ipa，签名模式下多一个 manifest.plist。文件名不带版本号，
# 因为官网和 R2 的链接都是固定的（client-mobile/Astravia-ios.ipa），发新版本不用改页面。

set -euo pipefail

cd "$(dirname "$0")/.."

OUT_DIR="build/ios"
ARCHIVE="$OUT_DIR/Astravia.xcarchive"
TEAM_ID="${TEAM_ID:-}"
PROFILE_UUID="${PROFILE_UUID:-}"
OTA_BASE="${OTA_BASE:-https://dl.astravia.dev/client-mobile}"

# project.yml 里的值带引号，直接用 awk 取第二列会把引号带进文件名。
version=$(sed -nE 's/^[[:space:]]*MARKETING_VERSION:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/p' project.yml | head -1)
if [[ -z "$version" ]]; then
	echo "无法从 project.yml 读到 MARKETING_VERSION" >&2
	exit 1
fi

rm -rf "$ARCHIVE"
mkdir -p "$OUT_DIR"

echo "==> 归档 iOS Release 版 (v$version)"
# 未签名模式显式关闭签名，否则 xcodebuild 会因为没有开发团队直接失败。
if [[ -n "$TEAM_ID" && -n "$PROFILE_UUID" ]]; then
	xcodebuild -project Astravia.xcodeproj -scheme Astravia \
		-configuration Release \
		-destination 'generic/platform=iOS' \
		-archivePath "$ARCHIVE" \
		DEVELOPMENT_TEAM="$TEAM_ID" \
		PROVISIONING_PROFILE="$PROFILE_UUID" \
		CODE_SIGN_STYLE=Manual \
		archive
else
	xcodebuild -project Astravia.xcodeproj -scheme Astravia \
		-configuration Release \
		-destination 'generic/platform=iOS' \
		-archivePath "$ARCHIVE" \
		CODE_SIGNING_ALLOWED=NO \
		CODE_SIGNING_REQUIRED=NO \
		CODE_SIGN_IDENTITY="" \
		archive
fi

app="$ARCHIVE/Products/Applications/Astravia.app"
if [[ ! -d "$app" ]]; then
	echo "归档里没有 Astravia.app，构建可能没真正产出设备版" >&2
	exit 1
fi

# WebRTC 是动态库，必须真的躺在包内，否则装到手机上一启动就崩。
if [[ ! -f "$app/Frameworks/WebRTC.framework/WebRTC" ]]; then
	echo "包内缺少 Frameworks/WebRTC.framework/WebRTC" >&2
	exit 1
fi

# 文件名必须与官网 mobile-install.ts 的链接和 R2 对象名完全一致，否则点下载是 404。
# 不嵌版本号是故意的：iOS 应用版本（1.0.0）与桌面版本（0.5.x）无关，嵌进去就得手工同步。
ipa="$OUT_DIR/Astravia-ios.ipa"
rm -f "$ipa"
staging="$OUT_DIR/Payload"
rm -rf "$staging"
mkdir -p "$staging"
ditto "$app" "$staging/Astravia.app"
(cd "$OUT_DIR" && zip -qry "$(basename "$ipa")" Payload)
rm -rf "$staging"

size=$(du -h "$ipa" | awk '{print $1}')
echo "==> $ipa ($size)"

if [[ -n "$TEAM_ID" && -n "$PROFILE_UUID" ]]; then
	# OTA 安装靠一个 manifest.plist：iOS 读它才知道去哪里下 IPA、装哪个 bundle。
	manifest="$OUT_DIR/manifest.plist"
	cat > "$manifest" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>items</key>
	<array>
		<dict>
			<key>assets</key>
			<array>
				<dict>
					<key>kind</key>
					<string>software-package</string>
					<key>url</key>
					<string>$OTA_BASE/Astravia-ios.ipa</string>
				</dict>
			</array>
			<key>metadata</key>
			<dict>
				<key>bundle-identifier</key>
				<string>com.astravia.mobile</string>
				<key>bundle-version</key>
				<string>$version</string>
				<key>kind</key>
				<string>software</string>
				<key>title</key>
				<string>Astravia</string>
			</dict>
		</dict>
	</array>
</dict>
</plist>
EOF
	echo "==> $manifest"
	echo "==> 安装链接（放官网按钮的 href）："
	echo "    itms-services://?action=download-manifest&url=$OTA_BASE/manifest.plist"
fi

cat <<EOF

接下来把产物上传到 R2 的 client-mobile/，页面上的链接才会生效：
    $ipa  →  $OTA_BASE/Astravia-ios.ipa
（`client-mobile-release` 流水线的 publish-r2 job 会自动完成这一步）
EOF

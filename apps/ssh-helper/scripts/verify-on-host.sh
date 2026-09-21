#!/bin/sh
# 在一台真实主机上验证远端 helper。
#
#   scripts/verify-on-host.sh user@host [ssh 的额外参数...]
#   scripts/verify-on-host.sh build-01 -p 2222 -i ~/.ssh/id_ed25519
#
# 仓库里的自动化测试都跑在回环夹具上（假 ssh 脚本把命令交给本机 /bin/sh），证明不了
# 真实 sshd、真实网络、以及目标机器的内核与 shell。这个脚本补的就是那一段。
#
# 它按 Vetta 自己的方式部署：同样的目录、同样的权限、同样的 sha256 校验，所以跑通了
# 就等于 Vetta 在这台机器上也能用。
set -eu

if [ $# -lt 1 ]; then
	echo "用法: $0 user@host [ssh 的额外参数...]" >&2
	exit 2
fi
HOST=$1
shift
SSH="ssh $* $HOST"

here=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROTOCOL_VERSION=$(sed -n 's/^const Version = "\(.*\)"$/\1/p' "$here/internal/protocol/protocol.go")
REMOTE_DIR="\$HOME/.cache/vetta/helper/$PROTOCOL_VERSION"
REMOTE_BIN="$REMOTE_DIR/vetta-ssh-helper"

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31m失败: %s\033[0m\n' "$1" >&2; exit 1; }
# 每次调用都是一条新的 SSH 连接、一个新的 helper 进程——「断开后任务还在不在」正是靠这点验证的。
helper() { $SSH "$REMOTE_BIN serve"; }
expect() { echo "$1" | grep -q "$2" || fail "$3"; }

step "1/6 探测远端平台"
platform=$($SSH 'uname -s -m') || fail "连不上 $HOST"
echo "  $platform"
case "$platform" in
Linux\ x86_64 | Linux\ amd64) target=linux-amd64 ;;
Linux\ aarch64 | Linux\ arm64) target=linux-arm64 ;;
Darwin\ x86_64) target=darwin-amd64 ;;
Darwin\ arm64) target=darwin-arm64 ;;
*) fail "不支持的远端平台: ${platform}（远程项目要求 Linux 或 macOS）" ;;
esac
binary="$here/dist/$target/vetta-ssh-helper"
[ -f "$binary" ] || fail "缺少 ${binary}，先跑 make cross-build"
echo "  用 dist/$target/vetta-ssh-helper"

step "2/6 上传并校验（与 Vetta 的部署方式一致）"
# 走 cat 而不是 scp：Vetta 就是这么传的，远端也未必装了 scp。
$SSH "mkdir -p $REMOTE_DIR && cat > $REMOTE_BIN && chmod 700 $REMOTE_BIN" <"$binary"
local_sum=$(shasum -a 256 "$binary" 2>/dev/null | cut -d' ' -f1 || sha256sum "$binary" | cut -d' ' -f1)
remote_sum=$($SSH "sha256sum $REMOTE_BIN 2>/dev/null || shasum -a 256 $REMOTE_BIN" | grep -oE '[0-9a-f]{64}')
[ "$local_sum" = "$remote_sum" ] || fail "校验和不一致：传输被破坏了"
echo "  sha256 一致"

step "3/6 握手"
hello=$(printf '{"id":1,"method":"hello"}\n' | helper)
echo "  $hello"
expect "$hello" "\"protocolVersion\":\"$PROTOCOL_VERSION\"" "握手没有返回预期的协议版本"

step "4/6 文件读写（写入保留权限位）"
probe="/tmp/vetta-helper-check-$$"
$SSH "printf 'old\n' > $probe.sh && chmod 755 $probe.sh"
data=$(printf 'new\n' | base64 | tr -d '\n')
out=$(printf '{"id":1,"method":"fs.writeFile","params":{"path":"%s.sh","data":"%s"}}\n{"id":2,"method":"fs.stat","params":{"path":"%s.sh"}}\n' "$probe" "$data" "$probe" | helper)
expect "$out" '"mode":493' "写入后权限位不再是 755——可执行脚本会被改坏"
expect "$($SSH "cat $probe.sh")" "new" "写入的内容没有落到远端"
echo "  内容已更新，权限位 755 保持不变"

step "5/6 后台任务：断开连接后是否继续运行"
task=$(printf '{"id":1,"method":"proc.spawn","params":{"command":"echo started; sleep 6; echo finished","cwd":"/tmp"}}\n' | helper)
id=$(echo "$task" | grep -oE '"id":"[0-9a-f]+"' | head -1 | cut -d'"' -f4)
[ -n "$id" ] || fail "启动任务失败: $task"
echo "  任务 $id 已启动，本条连接到此结束"
sleep 2

# 下面这两条各自是一条全新的连接。任务若绑在通道上，此刻它已经没了。
listed=$(printf '{"id":1,"method":"proc.list"}\n' | helper)
expect "$listed" "\"id\":\"$id\"" "重连后看不到这个任务"
expect "$listed" '"state":"live"' "任务没有活过连接断开——helper 的核心能力在这台机器上不生效"
echo "  重连后任务仍在运行 ✓"

read_out=$(printf '{"id":1,"method":"proc.read","params":{"id":"%s","offset":0,"waitMs":15000}}\n' "$id" | helper)
expect "$read_out" "started" "读不回任务的输出"
echo "  输出可续读 ✓"

step "6/6 收尾"
printf '{"id":1,"method":"proc.kill","params":{"id":"%s"}}\n{"id":2,"method":"proc.remove","params":{"id":"%s"}}\n' "$id" "$id" | helper >/dev/null
$SSH "rm -f $probe.sh"
printf '\n\033[32m全部通过：这台主机可以作为 Vetta 的远程项目使用。\033[0m\n'
echo "helper 留在 ${REMOTE_BIN}，删掉它只需 rm -rf \$HOME/.cache/vetta"

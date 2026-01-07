#!/bin/bash

# 完整的端到端测试脚本
# Complete end-to-end test script

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "🧪 Codex Code Remote - 完整端到端测试"
echo "======================================"

# 1. 检查服务状态
echo "📋 1. 检查服务状态"
echo -n "   ngrok服务: "
if pgrep -f "ngrok http" > /dev/null; then
    echo "✅ 运行中"
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url' 2>/dev/null || echo "获取失败")
    echo "   ngrok URL: $NGROK_URL"
else
    echo "❌ 未运行"
fi

echo -n "   Telegram webhook: "
if pgrep -f "start-telegram-webhook" > /dev/null; then
    echo "✅ 运行中"
else
    echo "❌ 未运行"
fi

# 2. 检查配置文件
echo ""
echo "📋 2. 检查配置文件"
echo -n "   ~/.codex/config.toml: "
if [ -f ~/.codex/config.toml ]; then
    echo "✅ 存在"
    echo "   Codex配置:"
    sed -n '1,60p' ~/.codex/config.toml 2>/dev/null || echo "   解析失败"
else
    echo "❌ 不存在"
fi

ENV_FILE="$HOME/.codex_code_remote_env"
echo -n "   环境文件: "
if [ -f "$ENV_FILE" ]; then
    echo "✅ 存在"
    echo "   Telegram配置:"
    grep "TELEGRAM_" "$ENV_FILE" | grep -v "BOT_TOKEN" | while read line; do
        echo "   $line"
    done
else
    echo "❌ 不存在"
fi

# 3. 测试hook脚本
echo ""
echo "📋 3. 测试通知脚本执行"
echo "   运行: node claude-hook-notify.js completed"
node claude-hook-notify.js completed

# 4. 检查最新session
echo ""
echo "📋 4. 检查最新创建的session"
if [ -d "src/data/sessions" ]; then
    LATEST_SESSION=$(ls -t src/data/sessions/*.json 2>/dev/null | head -1)
    if [ -n "$LATEST_SESSION" ]; then
        echo "   最新session: $(basename "$LATEST_SESSION")"
        echo "   内容摘要:"
        cat "$LATEST_SESSION" | jq -r '"\tToken: \(.token)\n\tType: \(.type)\n\tCreated: \(.created)\n\tTmux Session: \(.tmuxSession)"' 2>/dev/null || echo "   解析失败"
    else
        echo "   ❌ 未找到session文件"
    fi
else
    echo "   ❌ sessions目录不存在"
fi

# 5. 测试Telegram Bot连接
echo ""
echo "📋 5. 测试Telegram Bot连接"
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    echo "   发送测试消息到个人聊天..."
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\": $TELEGRAM_CHAT_ID, \"text\": \"🧪 端到端测试完成\\n\\n时间: $(date)\\n\\n如果你看到这条消息，说明基础通信正常。\\n\\n下一步：在Codex中完成一个任务，看是否能收到自动通知。\"}")
    
    if echo "$RESPONSE" | grep -q '"ok":true'; then
        echo "   ✅ 测试消息发送成功"
    else
        echo "   ❌ 测试消息发送失败"
        echo "   响应: $RESPONSE"
    fi
else
    echo "   ⚠️  Telegram配置不完整"
fi

# 6. 检查tmux sessions
echo ""
echo "📋 6. 检查tmux sessions"
if command -v tmux >/dev/null 2>&1; then
    echo "   当前tmux sessions:"
    tmux list-sessions 2>/dev/null || echo "   无活跃session"
else
    echo "   ❌ tmux未安装"
fi

echo ""
echo "🏁 测试完成"
echo ""
echo "💡 下一步调试建议:"
echo "1. 确认你收到了上面的Telegram测试消息"
echo "2. 在tmux中运行Codex，完成一个简单任务"
echo "3. 检查是否收到自动通知"
echo "4. 如果没有收到，检查Codex输出是否有错误信息"
echo ""
echo "🔧 如果仍有问题，请运行:"
echo "   tmux new-session -s codex-debug"
echo "   # 在新session中:"
echo "   codex"
echo "   # 在另一个终端运行: claude-remote monitor"
echo "   # 然后尝试一个简单任务"

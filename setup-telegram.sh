#!/bin/bash

# Codex Code Remote - Telegram Quick Setup Script
# This script helps you quickly set up Telegram notifications

echo "🚀 Codex Code Remote - Telegram Setup"
echo "====================================="

# Check if env file exists
ENV_FILE="$HOME/.codex_code_remote_env"
if [ ! -f "$ENV_FILE" ]; then
    echo "📋 Creating ~/.codex_code_remote_env from template..."
    cp .env.example "$ENV_FILE"
else
    echo "✅ ~/.codex_code_remote_env already exists"
fi

# Get project directory
PROJECT_DIR=$(pwd)
echo "📁 Project directory: $PROJECT_DIR"

echo "ℹ️ Codex CLI does not require hook configuration."

# Create data directory
mkdir -p src/data
echo "✅ Data directory ready"

echo ""
echo "📋 Next Steps:"
echo "1. Edit ~/.codex_code_remote_env and add your Telegram credentials:"
echo "   - TELEGRAM_BOT_TOKEN (from @BotFather)"
echo "   - TELEGRAM_CHAT_ID (your chat ID)"
echo "   - TELEGRAM_WEBHOOK_URL (your ngrok URL)"
echo ""
echo "2. Start ngrok in a terminal:"
echo "   ngrok http 3001"
echo ""
echo "3. Start Telegram webhook in another terminal:"
echo "   node start-telegram-webhook.js"
echo ""
echo "4. Start Codex in tmux, then run the monitor:"
echo "   tmux new-session -s codex-code"
echo "   codex"
echo "   # In another terminal:"
echo "   claude-remote monitor"
echo ""
echo "5. Test by running a task in Codex!"
echo ""
echo "For detailed instructions, see README.md"

#!/usr/bin/env node

/**
 * Test Telegram Notification
 * Simulates Codex sending a notification via Telegram
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment variables
const envPath = process.env.CODEX_CODE_REMOTE_ENV || path.join(os.homedir(), '.codex_code_remote_env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const TelegramChannel = require('./src/channels/telegram/telegram');

async function testNotification() {
    console.log('🧪 Testing Telegram notification...\n');
    
    // Configure Telegram channel
    const config = {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID
    };
    
    const telegramChannel = new TelegramChannel(config);
    
    // Create test notification
    const notification = {
        type: 'completed',
        title: 'Codex Task Completed',
        message: 'Test notification from Codex Code Remote',
        project: 'codex-code-line',
        metadata: {
            userQuestion: '請幫我查詢這個代碼庫：https://github.com/JessyTsui/Claude-Code-Remote',
            claudeResponse: '我已經查詢了這個代碼庫，這是一個 Codex Code Remote 項目，允許通過電子郵件遠程控制 Codex。',
            tmuxSession: 'codex-test'
        }
    };
    
    try {
        console.log('📱 Sending test notification...');
        const result = await telegramChannel.send(notification);
        
        if (result) {
            console.log('✅ Test notification sent successfully!');
            console.log('📋 Now you can reply with a command in this format:');
            console.log('   /cmd TOKEN123 <your new command>');
            console.log('\n🎯 Example:');
            console.log('   /cmd [TOKEN_FROM_MESSAGE] 請幫我分析這個專案的架構');
        } else {
            console.log('❌ Failed to send test notification');
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testNotification();

#!/usr/bin/env node

/**
 * Smart Monitor - 智能監控器，能檢測歷史回應和新回應
 * 解決監控器錯過已完成回應的問題
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');
const { execSync } = require('child_process');

// Load environment variables
const envPath = process.env.CODEX_CODE_REMOTE_ENV || path.join(os.homedir(), '.codex_code_remote_env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}

const TelegramChannel = require('./src/channels/telegram/telegram');

class SmartMonitor {
    constructor() {
        this.sessionName = process.env.TMUX_SESSION || 'codex-real';
        this.lastOutput = '';
        this.processedResponses = new Set(); // 記錄已處理的回應
        this.checkInterval = 1000; // Check every 1 second
        this.isRunning = false;
        this.startupTime = Date.now();
        
        // Setup Telegram
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
            const telegramConfig = {
                botToken: process.env.TELEGRAM_BOT_TOKEN,
                chatId: process.env.TELEGRAM_CHAT_ID
            };
            this.telegram = new TelegramChannel(telegramConfig);
            console.log('📱 Smart Monitor configured successfully');
        } else {
            console.log('❌ Telegram not configured');
            process.exit(1);
        }
    }

    start() {
        this.isRunning = true;
        console.log(`🧠 Starting smart monitor for session: ${this.sessionName}`);
        
        // Check for any unprocessed responses on startup
        this.checkForUnprocessedResponses();
        
        // Initial capture
        this.lastOutput = this.captureOutput();
        
        // Start monitoring
        this.monitor();
    }

    async checkForUnprocessedResponses() {
        console.log('🔍 Checking for unprocessed responses...');
        
        const currentOutput = this.captureOutput();
        const responses = this.extractAllResponses(currentOutput);
        
        // Check if there are recent responses (within 5 minutes) that might be unprocessed
        const recentResponses = responses.filter(response => {
            const responseAge = Date.now() - this.startupTime;
            return responseAge < 5 * 60 * 1000; // 5 minutes
        });
        
        if (recentResponses.length > 0) {
            console.log(`🎯 Found ${recentResponses.length} potentially unprocessed responses`);
            
            // Send notification for the most recent response
            const latestResponse = recentResponses[recentResponses.length - 1];
            await this.sendNotificationForResponse(latestResponse);
        } else {
            console.log('✅ No unprocessed responses found');
        }
    }

    captureOutput() {
        try {
            return execSync(`tmux capture-pane -t ${this.sessionName} -p`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            });
        } catch (error) {
            console.error('Error capturing tmux:', error.message);
            return '';
        }
    }

    autoApproveDialog() {
        try {
            console.log('🤖 Auto-approving Codex tool usage dialog...');
            
            // Send "1" to select the first option (usually "Yes")
            execSync(`tmux send-keys -t ${this.sessionName} '1'`, { encoding: 'utf8' });
            setTimeout(() => {
                execSync(`tmux send-keys -t ${this.sessionName} Enter`, { encoding: 'utf8' });
            }, 100);
            
            console.log('✅ Auto-approval sent successfully');
        } catch (error) {
            console.error('❌ Failed to auto-approve dialog:', error.message);
        }
    }

    extractAllResponses(content) {
        const lines = content.split('\n');
        const responses = [];
        const promptRegex = /^\s*[>›]\s+/;
        const promptOnlyRegex = /^\s*[>›]\s*$/;
        const isUiLine = (line) =>
            line.includes('? for shortcuts') || line.includes('context left') || line.match(/^[╭╰│─]+$/);
        
        let currentQuestion = null;
        let currentResponseLines = [];
        let currentIndex = -1;

        const flushResponse = () => {
            if (currentQuestion && currentResponseLines.length > 0) {
                const responseText = currentResponseLines.join('\n').trim();
                responses.push({
                    userQuestion: currentQuestion,
                    claudeResponse: responseText,
                    lineIndex: currentIndex,
                    responseId: `${currentQuestion}-${responseText}`.substring(0, 50),
                    type: 'standard'
                });
            }
        };
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (promptRegex.test(trimmed)) {
                flushResponse();
                currentQuestion = trimmed.replace(/^\s*[>›]\s+/, '').trim();
                currentResponseLines = [];
                currentIndex = i;
                continue;
            }

            if (currentQuestion && (promptRegex.test(trimmed) || promptOnlyRegex.test(trimmed))) {
                flushResponse();
                currentQuestion = null;
                currentResponseLines = [];
                currentIndex = -1;
                continue;
            }

            if (!currentQuestion) {
                continue;
            }

            if (!trimmed || isUiLine(trimmed)) {
                continue;
            }

            currentResponseLines.push(trimmed);

            // Look for interactive dialogs/tool confirmations
            if (line.includes('Do you want to proceed?') || 
                line.includes('❯ 1. Yes') ||
                line.includes('Tool use') ||
                (line.includes('│') && (line.includes('serena') || line.includes('MCP') || line.includes('initial_instructions')))) {
                
                // Check if this is part of a tool use dialog
                let dialogContent = '';
                let userQuestion = 'Recent command';
                
                // Look backward to find the start of the dialog and user question
                for (let j = i; j >= Math.max(0, i - 50); j--) {
                    const prevLine = lines[j];
                    if (prevLine.includes('╭') || prevLine.includes('Tool use')) {
                        // Found start of dialog box, now collect all content
                        for (let k = j; k <= Math.min(lines.length - 1, i + 20); k++) {
                            if (lines[k].includes('╰')) {
                                dialogContent += lines[k] + '\n';
                                break; // End of dialog box
                            }
                            dialogContent += lines[k] + '\n';
                        }
                        break;
                    }
                    // Look for user question
                    if (prevLine.startsWith('> ') && prevLine.length > 2) {
                        userQuestion = prevLine.substring(2).trim();
                    }
                }
                
                if (dialogContent.length > 50) { // Only if we found substantial dialog
                    // Auto-approve the dialog instead of asking user to go to iTerm2
                    this.autoApproveDialog();
                    
                    responses.push({
                        userQuestion,
                        claudeResponse: 'Codex requested tool permission - automatically approved. Processing...',
                        lineIndex: i,
                        responseId: `dialog-${userQuestion}-${Date.now()}`.substring(0, 50),
                        type: 'interactive',
                        fullDialog: dialogContent.substring(0, 500)
                    });
                    break; // Only send one dialog notification per check
                }
            }
        }
        
        flushResponse();
        
        return responses;
    }

    async monitor() {
        while (this.isRunning) {
            await this.sleep(this.checkInterval);
            
            const currentOutput = this.captureOutput();
            
            if (currentOutput !== this.lastOutput) {
                console.log('📝 Output changed, checking for new responses...');
                
                const oldResponses = this.extractAllResponses(this.lastOutput);
                const newResponses = this.extractAllResponses(currentOutput);
                
                // Find truly new responses
                const newResponseIds = new Set(newResponses.map(r => r.responseId));
                const oldResponseIds = new Set(oldResponses.map(r => r.responseId));
                
                const actuallyNewResponses = newResponses.filter(response => 
                    !oldResponseIds.has(response.responseId) && 
                    !this.processedResponses.has(response.responseId)
                );
                
                if (actuallyNewResponses.length > 0) {
                    console.log(`🎯 Found ${actuallyNewResponses.length} new responses`);
                    
                    for (const response of actuallyNewResponses) {
                        await this.sendNotificationForResponse(response);
                        this.processedResponses.add(response.responseId);
                    }
                } else {
                    console.log('ℹ️ No new responses detected');
                }
                
                this.lastOutput = currentOutput;
            }
        }
    }

    async sendNotificationForResponse(response) {
        try {
            console.log('📤 Sending notification for response:', response.claudeResponse.substring(0, 50) + '...');
            
            const notification = {
                type: 'completed',
                title: 'Codex Response Ready',
                message: 'Codex has responded to your command',
                project: 'codex-code-line',
                metadata: {
                    userQuestion: response.userQuestion,
                    claudeResponse: response.claudeResponse,
                    tmuxSession: this.sessionName,
                    workingDirectory: process.cwd(),
                    timestamp: new Date().toISOString(),
                    autoDetected: true
                }
            };
            
            const result = await this.telegram.send(notification);
            
            if (result) {
                console.log('✅ Notification sent successfully');
            } else {
                console.log('❌ Failed to send notification');
            }
            
        } catch (error) {
            console.error('❌ Notification error:', error.message);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    stop() {
        this.isRunning = false;
        console.log('⏹️ Smart Monitor stopped');
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            sessionName: this.sessionName,
            processedCount: this.processedResponses.size,
            uptime: Math.floor((Date.now() - this.startupTime) / 1000) + 's'
        };
    }
}

// Handle graceful shutdown
const monitor = new SmartMonitor();

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    monitor.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    monitor.stop();
    process.exit(0);
});

// Start monitoring
monitor.start();

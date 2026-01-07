/**
 * Tmux Monitor - Enhanced for real-time monitoring with Telegram/LINE automation
 * Monitors tmux session output for Codex completion patterns
 * Based on the original email automation mechanism but adapted for real-time notifications
 */

const { execSync } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const TraceCapture = require('./trace-capture');

class TmuxMonitor extends EventEmitter {
    constructor(sessionName = null) {
        super();
        this.sessionName = sessionName || process.env.TMUX_SESSION || 'codex-real';
        this.captureDir = path.join(__dirname, '../data/tmux-captures');
        this.isMonitoring = false;
        this.monitorInterval = null;
        this.lastPaneContent = '';
        this.outputBuffer = [];
        this.maxBufferSize = 1000; // Keep last 1000 lines
        this.checkInterval = 2000; // Check every 2 seconds
        this.lastCompletionTail = '';
        this.lastCompletionKey = '';
        this.lastTelegramDoneKey = '';
        
        // Codex completion patterns (adapted for Codex CLI output)
        this.completionPatterns = [
            // Task completion indicators
            /task.*completed/i,
            /successfully.*completed/i,
            /completed.*successfully/i,
            /implementation.*complete/i,
            /changes.*made/i,
            /created.*successfully/i,
            /updated.*successfully/i,
            /file.*created/i,
            /file.*updated/i,
            /finished/i,
            /done/i,
            /✅/,
            /All set/i,
            /Ready/i,
            
            // Codex CLI specific patterns
            /The file.*has been updated/i,
            /File created successfully/i,
            /Command executed successfully/i,
            /Operation completed/i,
            /context left/i,
            /Worked for \d+s/i,
            /•\s+Edited/i,
            /•\s+Updated/i,
            /^•\s+/m,
            /\(no output\)/i,
            /If you want/i,
            
            // Look for prompt return (indicating response finished)
            /╰.*╯\s*$/,  // Box ending
            /^\s*>\s*$/,  // Empty prompt ready for input
            /^\s*›\s*$/   // Codex prompt
        ];
        
        // Waiting patterns (when Codex needs input)
        this.waitingPatterns = [
            /waiting.*for/i,
            /need.*input/i,
            /please.*provide/i,
            /what.*would you like/i,
            /how.*can I help/i,
            /⏳/,
            /What would you like me to/i,
            /Is there anything else/i,
            /Any other/i,
            /Do you want/i,
            /Would you like/i,
            
            // Codex CLI specific waiting patterns
            /\? for shortcuts/i,  // Codex waiting indicator
            /context left/i,
            /╭.*─.*╮/,  // Start of response box
            />\s*$/,    // Empty prompt
            /›\s*$/     // Codex prompt
        ];
        
        this._ensureCaptureDir();
        this.traceCapture = new TraceCapture();
    }

    _isPromptLine(line) {
        const cleaned = this._stripAnsi(line || '');
        return /^\s*(?:[│|]\s*)?›\s+\S/.test(cleaned);
    }

    _isPromptOnlyLine(line) {
        const cleaned = this._stripAnsi(line || '');
        return /^\s*(?:[│|]\s*)?›\s*(?:[│|]\s*)?$/.test(cleaned);
    }

    _startsWithPrompt(line) {
        const cleaned = this._stripAnsi(line || '');
        return /^\s*(?:[│|]\s*)?›/.test(cleaned);
    }

    _stripAnsi(text) {
        return String(text).replace(/\u001b\[[0-9;]*m/g, '');
    }

    _ensureCaptureDir() {
        if (!fs.existsSync(this.captureDir)) {
            fs.mkdirSync(this.captureDir, { recursive: true });
        }
    }

    // Real-time monitoring methods (new functionality)
    start() {
        if (this.isMonitoring) {
            console.log('⚠️ TmuxMonitor already running');
            return;
        }

        // Verify tmux session exists
        if (!this._sessionExists()) {
            console.error(`❌ Tmux session '${this.sessionName}' not found`);
            throw new Error(`Tmux session '${this.sessionName}' not found`);
        }

        this.isMonitoring = true;
        this._startRealTimeMonitoring();
        console.log(`🔍 Started monitoring tmux session: ${this.sessionName}`);
    }

    stop() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        console.log('⏹️ TmuxMonitor stopped');
    }

    _sessionExists() {
        try {
            const sessions = execSync('tmux list-sessions -F "#{session_name}"', { 
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim().split('\n');
            
            return sessions.includes(this.sessionName);
        } catch (error) {
            return false;
        }
    }

    _startRealTimeMonitoring() {
        // Initial capture
        this._captureCurrentContent();
        
        // Set up periodic monitoring
        this.monitorInterval = setInterval(() => {
            if (this.isMonitoring) {
                this._checkForChanges();
            }
        }, this.checkInterval);
    }

    _captureCurrentContent() {
        try {
            // Capture current pane content
            const content = execSync(`tmux capture-pane -t ${this.sessionName} -p`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            });
            
            return content;
        } catch (error) {
            console.error('Error capturing tmux content:', error.message);
            return '';
        }
    }

    _checkForChanges() {
        const currentContent = this._captureCurrentContent();
        
        const contentChanged = currentContent !== this.lastPaneContent;
        if (contentChanged) {
            // Get new content (lines that were added)
            const newLines = this._getNewLines(this.lastPaneContent, currentContent);
            
            if (newLines.length > 0) {
                // Add to buffer
                this.outputBuffer.push(...newLines);
                
                // Trim buffer if too large
                if (this.outputBuffer.length > this.maxBufferSize) {
                    this.outputBuffer = this.outputBuffer.slice(-this.maxBufferSize);
                }
                
                // Check for completion patterns
                this._analyzeNewContent(newLines, currentContent);
            } else {
                // Fallback: if content changed but no new lines were detected,
                // check the tail for a returned prompt (Codex uses "›").
                const tailLines = currentContent
                    .split('\n')
                    .slice(-20)
                    .filter(line => line.trim().length > 0);
                const tailText = tailLines.join('\n');
                const lastTailLine = tailLines[tailLines.length - 1] || '';
                const hasPromptReturn = this._isPromptOnlyLine(lastTailLine);

                if (hasPromptReturn && tailText && tailText !== this.lastCompletionTail) {
                    this.lastCompletionTail = tailText;
                    this._analyzeNewContent(tailLines.slice(-5), currentContent);
                }
            }
            
        }

        // Always scan for Telegram completion marker when the pane changes
        if (currentContent && contentChanged) {
            const completionFromTelegramDone = this._detectTelegramDoneCompletion(currentContent);
            if (completionFromTelegramDone) {
                console.log('🎯 Task completion detected (Telegram done, pane scan)');
                this._handleTaskCompletion([], completionFromTelegramDone);
            }
        }

        if (contentChanged) {
            this.lastPaneContent = currentContent;
        }
    }

    _getNewLines(oldContent, newContent) {
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        
        // Find lines that were added
        const addedLines = [];
        
        // Simple approach: compare line by line from the end
        const oldLength = oldLines.length;
        const newLength = newLines.length;
        
        if (newLength > oldLength) {
            // New lines were added
            const numNewLines = newLength - oldLength;
            addedLines.push(...newLines.slice(-numNewLines));
        } else if (newLength === oldLength) {
            // Same number of lines, check if last lines changed
            for (let i = Math.max(0, newLength - 5); i < newLength; i++) {
                if (i < oldLength && newLines[i] !== oldLines[i]) {
                    addedLines.push(newLines[i]);
                }
            }
        }
        
        return addedLines.filter(line => line.trim().length > 0);
    }

    _analyzeNewContent(newLines, currentContent = '') {
        const recentText = newLines.join('\n');
        
        // Also check the entire recent buffer for context
        const bufferText = this.outputBuffer.slice(-20).join('\n');
        const paneText = currentContent || this.lastPaneContent;

        console.log('🔍 Analyzing new content:', newLines.slice(0, 2).map(line => line.substring(0, 50))); // Debug log
        const completionFromTelegramDone = this._detectTelegramDoneCompletion(paneText);
        if (completionFromTelegramDone) {
            console.log('🎯 Task completion detected (Telegram done)');
            this._handleTaskCompletion(newLines, completionFromTelegramDone);
            return;
        }

        const completionFromPane = this._detectCompletionFromPane(paneText);
        if (completionFromPane) {
            console.log('🎯 Task completion detected (pane analysis)');
            this._handleTaskCompletion(newLines);
            return;
        }
        
        // Look for assistant response completion patterns
        const hasResponseEnd = this._detectResponseCompletion(recentText, bufferText, paneText);
        const hasTaskCompletion = this._detectTaskCompletion(recentText, bufferText);
        
        if (hasTaskCompletion || hasResponseEnd) {
            console.log('🎯 Task completion detected');
               this._handleTaskCompletion(newLines);
            }
        // Don't constantly trigger waiting notifications for static content
        else if (this._shouldTriggerWaitingNotification(recentText)) {
            console.log('⏳ New waiting state detected');
            this._handleWaitingForInput(newLines);
        }
    }
    
    _detectResponseCompletion(recentText, bufferText, paneText = '') {
        // Treat prompt return as completion signal using the full pane when possible
        const sourceText = paneText || bufferText || recentText;
        const tailLines = sourceText
            .split('\n')
            .slice(-8)
            .filter(line => line.trim().length > 0);
        const hasPromptTail = tailLines.some(line => this._isPromptOnlyLine(line));
        if (hasPromptTail) {
            return true;
        }

        // Look for assistant response completion indicators
        const completionIndicators = [
            /The file.*has been updated/i,
            /File created successfully/i,
            /successfully/i,
            /completed/i,
            /✅/,
            /done/i,
            /context left/i,
            /Worked for \d+s/i,
            /\(no output\)/i,
            /^•\s+/m,
            /If you want/i
        ];
        
        // Codex/Claude response followed by box or prompt
        const hasClaudeResponse = /⏺.*/.test(bufferText) || /⏺.*/.test(recentText);
        const hasBoxStart = /╭.*╮/.test(recentText);
        const hasBoxEnd = /╰.*╯/.test(recentText);
        
        // Look for the pattern: ⏺ response -> box -> empty prompt
        const isCompleteResponse = hasClaudeResponse && (hasBoxStart || hasBoxEnd);
        
        return completionIndicators.some(pattern => pattern.test(recentText)) ||
               completionIndicators.some(pattern => pattern.test(bufferText)) ||
               isCompleteResponse;
    }

    _detectCompletionFromPane(paneText) {
        if (!paneText) return false;

        const conversation = this._extractRecentConversation(paneText);
        const response = conversation?.claudeResponse || '';
        if (!response) return false;

        const hasTelegramDone = /Telegram done/i.test(response);
        const hasWorkedFor = /Worked for \d+s/i.test(response) || /─ Worked for \d+s/i.test(response);
        const hasSummary = /(^|\n)•\s+/m.test(response) || /\(no output\)/i.test(response);
        // If we have a Telegram completion marker anywhere, prefer it over heuristics.
        if (hasTelegramDone) {
            const key = `${conversation.userQuestion}::${response.match(/Telegram done/i)?.index || 0}`;
            if (key === this.lastCompletionKey) {
                return false;
            }
            this.lastCompletionKey = key;
            return true;
        }
        if (!(hasWorkedFor || hasSummary)) return false;

        const key = `${conversation.userQuestion}::${response.slice(-500)}`;
        if (key === this.lastCompletionKey) {
            return false;
        }
        this.lastCompletionKey = key;
        return true;
    }

    _detectTelegramDoneCompletion(paneText) {
        if (!paneText) return null;
        const lines = paneText.split('\n');
        let lastIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            if (/Telegram done/i.test(lines[i])) {
                lastIndex = i;
                break;
            }
        }
        if (lastIndex === -1) return null;

        // Derive a stable key to avoid repeated notifications
        let promptLine = '';
        let promptIndex = -1;
        for (let i = lastIndex; i >= 0; i--) {
            if (this._isPromptLine(lines[i])) {
                promptLine = this._stripAnsi(lines[i]).replace(/^\s*(?:[│|]\s*)?›\s+/, '').trim();
                promptIndex = i;
                break;
            }
        }
        const doneLine = this._stripAnsi(lines[lastIndex]).trim();
        const key = promptLine ? `${promptLine}::${doneLine}` : `${lastIndex}::${doneLine}`;
        if (key === this.lastTelegramDoneKey) {
            return null;
        }
        this.lastTelegramDoneKey = key;
        const isUiLine = (line) =>
            line.includes('? for shortcuts') ||
            line.includes('context left') ||
            line.match(/^[\s╭╰│─┤┐┘┌└]+$/);

        const responseLines = [];
        const responseStart = promptIndex !== -1 ? promptIndex + 1 : Math.max(0, lastIndex - 40);
        for (let i = responseStart; i < lines.length; i++) {
            const trimmed = this._stripAnsi(lines[i]).trim();
            if (!trimmed) continue;
            if (i > promptIndex && this._isPromptLine(trimmed)) break;
            if (this._isPromptOnlyLine(trimmed)) continue;
            if (isUiLine(trimmed)) continue;
            if (/After task is completed, write \"Telegram done\" here/i.test(trimmed)) continue;
            responseLines.push(trimmed);
        }

        const claudeResponse = responseLines.join('\n').trim();

        return {
            userQuestion: promptLine || 'Recent command',
            claudeResponse: claudeResponse || 'Task completed',
            fullContext: lines.slice(Math.max(0, responseStart - 5), Math.min(lines.length, lastIndex + 10)).join('\n')
        };
    }
    
    _detectTaskCompletion(recentText, bufferText) {
        // Look for specific completion patterns
        return this.completionPatterns.some(pattern => pattern.test(recentText)) ||
               this.completionPatterns.some(pattern => pattern.test(bufferText));
    }
    
    _shouldTriggerWaitingNotification(recentText) {
        // Only trigger waiting notification for new meaningful content
        // Avoid triggering on static "? for shortcuts" that doesn't change
        const meaningfulWaitingPatterns = [
            /waiting.*for/i,
            /need.*input/i,
            /please.*provide/i,
            /what.*would you like/i,
            /Do you want/i,
            /Would you like/i,
            /context left/i
        ];
        
        return meaningfulWaitingPatterns.some(pattern => pattern.test(recentText)) &&
               !recentText.includes('? for shortcuts'); // Ignore static shortcuts line
    }

    _handleTaskCompletion(newLines, conversationOverride = null) {
        const fullContent = this._captureCurrentContent();
        const conversation = conversationOverride || this._extractRecentConversation(fullContent);
        
        console.log('🎉 Codex task completion detected!');
        
        this.emit('taskCompleted', {
            type: 'completed',
            sessionName: this.sessionName,
            timestamp: new Date().toISOString(),
            newOutput: newLines,
            conversation: conversation,
            triggerText: newLines.join('\n')
        });
    }

    _handleWaitingForInput(newLines) {
        const fullContent = this._captureCurrentContent();
        const conversation = this._extractRecentConversation(fullContent);
        
        console.log('⏳ Codex waiting for input detected!');
        
        this.emit('waitingForInput', {
            type: 'waiting',
            sessionName: this.sessionName,
            timestamp: new Date().toISOString(),
            newOutput: newLines,
            conversation: conversation,
            triggerText: newLines.join('\n')
        });
    }

    _extractRecentConversation(fullContent = null) {
        const isUiLine = (line) =>
            line.includes('? for shortcuts') ||
            line.includes('context left') ||
            line.match(/^[\s╭╰│─┤┐┘┌└]+$/);

        const sourceLines = (fullContent || this.outputBuffer.join('\n'))
            .split('\n')
            .slice(-200); // Limit to recent tail
        const lines = sourceLines;

        let userQuestion = '';
        let responseLines = [];

        // Find the last prompt line with user text
        let promptTextIndex = -1;
        const searchStart = lines.length - 1;
        for (let i = searchStart; i >= 0; i--) {
            const trimmed = lines[i].trim();
            if (this._isPromptLine(trimmed)) {
                promptTextIndex = i;
                userQuestion = trimmed.replace(/^\s*(?:[│|]\s*)?›\s+/, '').trim();
                break;
            }
        }

        const responseStart = promptTextIndex !== -1 ? promptTextIndex + 1 : Math.max(0, lines.length - 40);

        for (let i = responseStart; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;
            if (this._isPromptLine(trimmed)) break;
            if (this._isPromptOnlyLine(trimmed)) continue;
            if (isUiLine(trimmed)) continue;
            responseLines.push(trimmed);
        }

        if (!userQuestion && promptTextIndex === -1) {
            for (let i = responseStart - 1; i >= 0; i--) {
                const trimmed = lines[i].trim();
                if (trimmed && !isUiLine(trimmed) && !this._isPromptOnlyLine(trimmed)) {
                    userQuestion = trimmed;
                    break;
                }
            }
        }

        let claudeResponse = responseLines.join('\n').trim();
        if (!claudeResponse) {
            const fallbackLines = lines
                .slice(Math.max(responseStart, lines.length - 40), lines.length)
                .map(line => line.trim())
                .filter(line => line && !isUiLine(line) && !this._isPromptOnlyLine(line));
            claudeResponse = fallbackLines.join('\n').trim();
        }

        return {
            userQuestion: userQuestion || 'Recent command',
            claudeResponse: claudeResponse || 'Task completed',
            fullContext: lines.join('\n')
        };
    }

    // Manual trigger methods for testing
    triggerCompletionTest() {
        this._handleTaskCompletion(['Test completion notification']);
    }

    triggerWaitingTest() {
        this._handleWaitingForInput(['Test waiting notification']);
    }

    // Original capture methods (legacy support)
    /**
     * Start capturing a tmux session
     * @param {string} sessionName - The tmux session name
     */
    startCapture(sessionName) {
        try {
            const captureFile = path.join(this.captureDir, `${sessionName}.log`);
            
            // Start pipe-pane to capture all session output
            execSync(`tmux pipe-pane -t ${sessionName} -o "cat >> ${captureFile}"`, { 
                encoding: 'utf8',
                stdio: 'ignore' 
            });
            
            return captureFile;
        } catch (error) {
            console.error(`Failed to start capture for session ${sessionName}:`, error.message);
            return null;
        }
    }

    /**
     * Stop capturing a tmux session
     * @param {string} sessionName - The tmux session name
     */
    stopCapture(sessionName) {
        try {
            execSync(`tmux pipe-pane -t ${sessionName}`, { 
                encoding: 'utf8',
                stdio: 'ignore' 
            });
        } catch (error) {
            console.error(`Failed to stop capture for session ${sessionName}:`, error.message);
        }
    }

    /**
     * Get recent conversation from a tmux session
     * @param {string} sessionName - The tmux session name
     * @param {number} lines - Number of lines to retrieve
     * @returns {Object} - { userQuestion, claudeResponse }
     */
    getRecentConversation(sessionName, lines = 200) {
        try {
            const captureFile = path.join(this.captureDir, `${sessionName}.log`);
            
            if (!fs.existsSync(captureFile)) {
                // If no capture file, try to get from tmux buffer
                return this.getFromTmuxBuffer(sessionName, lines);
            }

            // Read the capture file
            const content = fs.readFileSync(captureFile, 'utf8');
            const allLines = content.split('\n');
            const recentLines = allLines.slice(-lines);

            return this.extractConversation(recentLines.join('\n'), sessionName);
        } catch (error) {
            console.error(`Failed to get conversation for session ${sessionName}:`, error.message);
            return { userQuestion: '', claudeResponse: '' };
        }
    }

    /**
     * Get conversation from tmux buffer
     * @param {string} sessionName - The tmux session name
     * @param {number} lines - Number of lines to retrieve
     */
    getFromTmuxBuffer(sessionName, lines = 200) {
        try {
            // Capture the pane contents
            const buffer = execSync(`tmux capture-pane -t ${sessionName} -p -S -${lines}`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            });

            return this.extractConversation(buffer, sessionName);
        } catch (error) {
            console.error(`Failed to get tmux buffer for session ${sessionName}:`, error.message);
            return { userQuestion: '', claudeResponse: '' };
        }
    }

    /**
     * Get full execution trace from tmux session
     * @param {string} sessionName - The tmux session name
     * @param {number} lines - Number of lines to retrieve
     * @returns {string} - Full execution trace
     */
    getFullExecutionTrace(sessionName, lines = 1000) {
        try {
            let content;
            if (!fs.existsSync(path.join(this.captureDir, `${sessionName}.log`))) {
                // If no capture file, try to get from tmux buffer
                content = this.getFullTraceFromTmuxBuffer(sessionName, lines);
            } else {
                // Read the capture file
                content = fs.readFileSync(path.join(this.captureDir, `${sessionName}.log`), 'utf8');
            }
            
            // Always filter content to only show from last user input
            content = this._filterByTimestamp(content);
            
            // Clean up the trace by removing the command prompt box
            return this._cleanExecutionTrace(content);
        } catch (error) {
            console.error(`Failed to get full trace for session ${sessionName}:`, error.message);
            return '';
        }
    }
    
    /**
     * Filter content to only include lines after the last user input
     * @param {string} content - The full content
     * @param {number} timestamp - Unix timestamp in milliseconds (not used in current implementation)
     * @returns {string} - Filtered content
     */
    _filterByTimestamp(content, timestamp) {
        const lines = content.split('\n');
        let lastUserInputIndex = -1;
        
        // Find the LAST occurrence of user input (line starting with "›")
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            // Check for user input pattern: "› " at the start of the line
            if (this._isPromptLine(line) && line.trim().length > 2) {
                lastUserInputIndex = i;
                break;
            }
        }
        
        // If we found user input, return everything from that point
        if (lastUserInputIndex >= 0) {
            return lines.slice(lastUserInputIndex).join('\n');
        }
        
        // If no user input found, return last 100 lines as fallback
        return lines.slice(-100).join('\n');
    }
    
    /**
     * Clean execution trace by removing command prompt and status line
     * Also removes the complete user input and final assistant response
     * @param {string} trace - Raw execution trace
     * @returns {string} - Cleaned trace
     */
    _cleanExecutionTrace(trace) {
        const lines = trace.split('\n');
        const cleanedLines = [];
        let inUserInput = false;
        let skipNextEmptyLine = false;
        let lastClaudeResponseStart = -1;
        
        // Find where the last assistant response starts (Claude-format if present)
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].startsWith('⏺ ')) {
                lastClaudeResponseStart = i;
                break;
            }
        }
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip everything from the last assistant response onward
            if (lastClaudeResponseStart !== -1 && i >= lastClaudeResponseStart) {
                // But we want to show everything BEFORE the last response
                break;
            }
            
            // Start of user input
            if (this._isPromptLine(line)) {
                inUserInput = true;
                skipNextEmptyLine = true;
                continue;
            }
            
            // Still in user input (continuation lines)
            if (inUserInput) {
                // Check if we've reached the end of user input
                if (line.trim() === '' || line.startsWith('⏺')) {
                    inUserInput = false;
                    if (skipNextEmptyLine && line.trim() === '') {
                        skipNextEmptyLine = false;
                        continue;
                    }
                } else {
                    continue; // Skip user input continuation lines
                }
            }
            
            // Check if we've hit the command prompt box
            if (line.includes('╭─') && line.includes('─╮')) {
                break;
            }
            
            // Skip empty command prompt lines
            if (line.match(/^│\s*›\s*│$/)) {
                break;
            }
            
            cleanedLines.push(line);
        }
        
        // Remove empty lines at the beginning and end
        while (cleanedLines.length > 0 && cleanedLines[0].trim() === '') {
            cleanedLines.shift();
        }
        while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() === '') {
            cleanedLines.pop();
        }
        
        return cleanedLines.join('\n');
    }

    /**
     * Get full trace from tmux buffer
     * @param {string} sessionName - The tmux session name
     * @param {number} lines - Number of lines to retrieve
     */
    getFullTraceFromTmuxBuffer(sessionName, lines = 1000) {
        try {
            // Capture the pane contents
            const buffer = execSync(`tmux capture-pane -t ${sessionName} -p -S -${lines}`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            });

            return buffer;
        } catch (error) {
            console.error(`Failed to get tmux buffer for session ${sessionName}:`, error.message);
            return '';
        }
    }

    /**
     * Extract user question and assistant response from captured text
     * @param {string} text - The captured text
     * @param {string} sessionName - The tmux session name (optional)
     * @returns {Object} - { userQuestion, claudeResponse }
     */
    extractConversation(text, sessionName = null) {
        const lines = text.split('\n');
        const isUiLine = (line) =>
            line.includes('? for shortcuts') ||
            line.includes('context left') ||
            line.match(/^[\s╭╰│─┤┐┘┌└]+$/);

        const normalizedLines = lines;
        let userQuestion = '';
        let responseLines = [];

        // Find the most recent user question
        let promptIndex = -1;
        for (let i = normalizedLines.length - 1; i >= 0; i--) {
            const trimmed = normalizedLines[i].trim();
            if (this._isPromptLine(trimmed)) {
                promptIndex = i;
                userQuestion = trimmed.replace(/^\s*(?:[│|]\s*)?›\s+/, '').trim();
                break;
            }
        }

        if (promptIndex !== -1) {
            if (sessionName) {
                this.traceCapture.recordUserInput(sessionName);
            }
            for (let i = promptIndex + 1; i < normalizedLines.length; i++) {
                const trimmed = normalizedLines[i].trim();
                if (!trimmed) continue;
                if (this._isPromptLine(trimmed)) break;
                if (this._isPromptOnlyLine(trimmed)) continue;
                if (isUiLine(trimmed)) continue;
                responseLines.push(trimmed);
            }
        }

        if (!userQuestion) {
            for (let i = normalizedLines.length - 1; i >= 0; i--) {
                const trimmed = normalizedLines[i].trim();
                if (trimmed && !isUiLine(trimmed)) {
                    userQuestion = trimmed;
                    break;
                }
            }
        }

        const claudeResponse = responseLines.join('\n').trim();

        return { 
            userQuestion: userQuestion || 'No user input',
            claudeResponse: claudeResponse || 'No response'
        };
    }

    /**
     * Clean up old capture files
     * @param {number} daysToKeep - Number of days to keep capture files
     */
    cleanupOldCaptures(daysToKeep = 7) {
        try {
            const files = fs.readdirSync(this.captureDir);
            const now = Date.now();
            const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

            files.forEach(file => {
                const filePath = path.join(this.captureDir, file);
                const stats = fs.statSync(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up old capture file: ${file}`);
                }
            });
        } catch (error) {
            console.error('Failed to cleanup captures:', error.message);
        }
    }

    // Enhanced status method
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            sessionName: this.sessionName,
            sessionExists: this._sessionExists(),
            bufferSize: this.outputBuffer.length,
            checkInterval: this.checkInterval,
            patterns: {
                completion: this.completionPatterns.length,
                waiting: this.waitingPatterns.length
            },
            lastCheck: new Date().toISOString()
        };
    }
}

module.exports = TmuxMonitor;

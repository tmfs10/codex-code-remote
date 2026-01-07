/**
 * Codex-Code-Remote Installer
 * Handles installation and configuration for Codex CLI
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');
const Logger = require('../core/logger');

class Installer {
    constructor(configManager) {
        this.config = configManager;
        this.logger = new Logger('Installer');
        this.projectDir = path.join(__dirname, '../..');
        this.codexConfigDir = this.getCodexConfigDir();
        
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    getCodexConfigDir() {
        const homeDir = os.homedir();
        return path.join(homeDir, '.codex');
    }

    async question(prompt) {
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    async run(args = []) {
        console.log('=== Codex-Code-Remote Installer ===\n');

        // Check dependencies
        if (!this.checkDependencies()) {
            console.log('\nPlease install required dependencies first');
            this.rl.close();
            return;
        }

        console.log(`\nCodex configuration directory: ${this.codexConfigDir}`);
        
        const proceed = await this.question('\nContinue with installation? (y/n): ');
        if (proceed.toLowerCase() !== 'y' && proceed.toLowerCase() !== 'yes') {
            console.log('Installation cancelled');
            this.rl.close();
            return;
        }

        // Initialize configuration
        await this.initializeConfig();

        // Test installation
        const testChoice = await this.question('\nTest installation? (y/n): ');
        if (testChoice.toLowerCase() === 'y' || testChoice.toLowerCase() === 'yes') {
            await this.testInstallation();
        }

        this.displayUsage();
        this.rl.close();
    }

    checkDependencies() {
        console.log('Checking dependencies...');
        
        // Check Node.js
        try {
            const nodeVersion = process.version;
            console.log(`✅ Node.js ${nodeVersion}`);
        } catch (error) {
            console.log('❌ Node.js not installed');
            return false;
        }

        // Check Codex CLI
        try {
            const codexCli = process.env.CODEX_CLI_PATH || 'codex';
            execSync(`command -v ${codexCli}`, { stdio: 'ignore' });
            console.log(`✅ Codex CLI (${codexCli})`);
        } catch (error) {
            console.log('⚠️  Codex CLI not found in PATH');
            console.log('   Install with: npm install -g @openai/codex');
        }

        // Check platform-specific notification tools
        const platform = process.platform;
        switch (platform) {
            case 'darwin':
                console.log('✅ macOS notification support');
                break;
            case 'linux':
                console.log('ℹ️  Linux system, please ensure libnotify-bin is installed');
                break;
            case 'win32':
                console.log('✅ Windows notification support');
                break;
            default:
                console.log(`⚠️  Platform ${platform} may not be fully supported`);
        }

        return true;
    }

    createHooksConfig() {
        const claudeRemotePath = path.join(this.projectDir, 'claude-remote.js');
        
        return {
            hooks: {
                Stop: [
                    {
                        matcher: "*",
                        hooks: [
                            {
                                type: "command",
                                command: `node "${claudeRemotePath}" notify --type completed`,
                                timeout: 5
                            }
                        ]
                    }
                ],
                SubagentStop: [
                    {
                        matcher: "*",
                        hooks: [
                            {
                                type: "command", 
                                command: `node "${claudeRemotePath}" notify --type waiting`,
                                timeout: 5
                            }
                        ]
                    }
                ]
            }
        };
    }

    async installHooks() {
        console.log('\nCodex CLI does not currently support hooks. Skipping hooks installation.');
        console.log('Use "claude-remote monitor" to auto-notify based on tmux output.');
        return true;
    }

    async initializeConfig() {
        console.log('\nInitializing configuration...');
        
        // Load and save default configuration
        this.config.load();
        this.config.save();
        
        console.log('✅ Configuration file initialized');
    }

    async testInstallation() {
        console.log('\nTesting installation...');
        
        try {
            const ClaudeCodeRemoteCLI = require('../../claude-remote');
            const cli = new ClaudeCodeRemoteCLI();
            await cli.init();
            
            console.log('Testing task completion notification...');
            await cli.handleNotify(['--type', 'completed']);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('Testing waiting input notification...');
            await cli.handleNotify(['--type', 'waiting']);
            
            console.log('✅ Test successful!');
            return true;
        } catch (error) {
            console.error(`❌ Test failed: ${error.message}`);
            return false;
        }
    }

    displayUsage() {
        console.log('\n=== Installation Complete ===');
        console.log('');
        console.log('Now when you use Codex:');
        console.log('• You will receive notifications when tasks are completed');
        console.log('• You will receive reminders when Codex is waiting for input');
        console.log('');
        console.log('Common commands:');
        console.log(`  node "${path.join(this.projectDir, 'claude-remote.js')}" config`);
        console.log(`  node "${path.join(this.projectDir, 'claude-remote.js')}" test`);
        console.log(`  node "${path.join(this.projectDir, 'claude-remote.js')}" status`);
        console.log(`  node "${path.join(this.projectDir, 'claude-remote.js')}" monitor`);
        console.log('');
        console.log('To stop monitoring, exit the monitor command or daemon.');
    }
}

module.exports = Installer;

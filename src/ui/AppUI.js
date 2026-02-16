
import { UsbConnection } from '../services/UsbConnection.js';
import { WebSocketClient } from '../services/WebSocketClient.js';
import { RBYTrading } from '../services/RBYTrading.js';
import { GSCTrading } from '../services/GSCTrading.js';
import { SettingsManager } from '../services/SettingsManager.js';
import { multiboot } from '../services/Multiboot.js';
import { RSESPTrading } from '../services/RSESPTrading.js';

export class AppUI {
    constructor() {
        this.usb = new UsbConnection();
        this.ws = new WebSocketClient();
        this.protocol = null;
        this.settings = new SettingsManager();

        this.elements = {
            // Status elements
            usbStatus: document.getElementById('usb-status'),

            // Main buttons
            btnConnectUsb: document.getElementById('btn-connect-usb'),
            btnStartTrade: document.getElementById('btn-start-trade'),
            btnSendMultiboot: document.getElementById('btn-send-multiboot'),
            btnSettings: document.getElementById('btn-settings'),

            // Trade setup - button groups
            genSelectGroup: document.getElementById('gen-select'),
            tradeTypeGroup: document.getElementById('trade-type-group'),
            tradeTypeSelectGroup: document.getElementById('trade-type-select'),
            gameVersions: document.getElementById('game-versions'),
            btnTimeCapsule: document.getElementById('btn-time-capsule'),
            roomCodeGroup: document.getElementById('room-code-group'),
            roomCode: document.getElementById('room-code'),
            btnGenerateRoom: document.getElementById('btn-generate-room'),

            // Negotiation popup
            negotiationPopup: document.getElementById('negotiation-popup'),
            negotiationMessage: document.getElementById('negotiation-message'),
            btnNegotiateYes: document.getElementById('btn-negotiate-yes'),
            btnNegotiateNo: document.getElementById('btn-negotiate-no'),

            // Log
            logContainer: document.getElementById('log-container'),

            // Settings modal
            settingsModal: document.getElementById('settings-modal'),
            btnCloseSettings: document.getElementById('btn-close-settings'),
            btnResetDefaults: document.getElementById('btn-reset-defaults'),
            btnSaveSettings: document.getElementById('btn-save-settings'),

            // Settings inputs
            settingServerUrl: document.getElementById('setting-server-url'),
            settingJapanese: document.getElementById('setting-japanese'),
            settingSanityChecks: document.getElementById('setting-sanity-checks'),
            settingVerbose: document.getElementById('setting-verbose'),
            settingDarkMode: document.getElementById('setting-dark-mode'),
            settingBuffered: document.getElementById('setting-buffered'),
            settingCrashSync: document.getElementById('setting-crash-sync'),
            settingMaxLevel: document.getElementById('setting-max-level'),
            settingMaxLevelSlider: document.getElementById('setting-max-level-slider'),
            settingConvertEggs: document.getElementById('setting-convert-eggs')
        };

        // Track current selections
        this.selectedGen = null;
        this.selectedTradeType = 'link'; // Default to 2-Player
        this.isTimeCapsule = false;
        this.isTradeActive = false; // Track if trade is currently running

        this.attachListeners();
        this.loadSettingsToUI();
        this.applyTheme();
    }

    attachListeners() {
        // Main UI
        this.elements.btnConnectUsb.addEventListener('click', () => this.connectUsb());
        this.elements.btnStartTrade.addEventListener('click', () => this.startTrade());
        this.elements.btnSendMultiboot.addEventListener('click', () => this.sendMultiboot());
        this.elements.btnTimeCapsule.addEventListener('click', () => this.toggleTimeCapsule());
        this.elements.btnGenerateRoom.addEventListener('click', () => this.generateRoomCode());

        // Generation button group
        this.elements.genSelectGroup.querySelectorAll('.btn-option').forEach(btn => {
            btn.addEventListener('click', () => this.onGenSelect(btn));
        });

        // Trade type button group
        this.elements.tradeTypeSelectGroup.querySelectorAll('.btn-option').forEach(btn => {
            btn.addEventListener('click', () => this.onTradeTypeSelect(btn));
        });

        // Settings modal
        this.elements.btnSettings.addEventListener('click', () => this.openSettings());
        this.elements.btnCloseSettings.addEventListener('click', () => this.closeSettings());
        this.elements.btnResetDefaults.addEventListener('click', () => this.resetToDefaults());
        this.elements.btnSaveSettings.addEventListener('click', () => this.saveSettings());

        // Close modal on overlay click
        this.elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.settingsModal) {
                this.closeSettings();
            }
        });

        // Update default indicators on change
        const settingInputs = [
            this.elements.settingServerUrl,
            this.elements.settingJapanese,
            this.elements.settingSanityChecks,
            this.elements.settingVerbose,
            this.elements.settingDarkMode,
            this.elements.settingBuffered,
            this.elements.settingCrashSync,
            this.elements.settingMaxLevel,
            this.elements.settingMaxLevelSlider,
            this.elements.settingConvertEggs
        ];

        settingInputs.forEach(input => {
            input.addEventListener('change', () => this.updateDefaultIndicators());
            if (input.type === 'text' || input.type === 'number' || input.type === 'range') {
                input.addEventListener('input', () => this.updateDefaultIndicators());
            }
        });

        // Sync slider and number input for max level
        this.elements.settingMaxLevelSlider.addEventListener('input', () => {
            this.elements.settingMaxLevel.value = this.elements.settingMaxLevelSlider.value;
        });
        this.elements.settingMaxLevel.addEventListener('input', () => {
            this.elements.settingMaxLevelSlider.value = this.elements.settingMaxLevel.value;
        });
    }

    // === Settings Modal ===

    openSettings() {
        this.loadSettingsToUI();
        this.elements.settingsModal.style.display = 'flex';
    }

    closeSettings() {
        this.elements.settingsModal.style.display = 'none';
    }

    loadSettingsToUI() {
        const s = this.settings.getAll();

        this.elements.settingServerUrl.value = s.serverUrl;
        this.elements.settingJapanese.checked = s.isJapanese;
        this.elements.settingSanityChecks.checked = s.doSanityChecks;
        this.elements.settingVerbose.checked = s.verbose;
        this.elements.settingDarkMode.checked = s.darkMode;
        this.elements.settingBuffered.checked = s.isBuffered;
        this.elements.settingCrashSync.checked = s.crashOnSyncDrop;
        this.elements.settingMaxLevel.value = s.maxLevel;
        this.elements.settingMaxLevelSlider.value = s.maxLevel;
        this.elements.settingConvertEggs.checked = s.convertToEggs;

        this.updateDefaultIndicators();
    }

    saveSettings() {
        this.settings.set('serverUrl', this.elements.settingServerUrl.value.trim());
        this.settings.set('isJapanese', this.elements.settingJapanese.checked);
        this.settings.set('doSanityChecks', this.elements.settingSanityChecks.checked);
        this.settings.set('verbose', this.elements.settingVerbose.checked);
        this.settings.set('darkMode', this.elements.settingDarkMode.checked);
        this.settings.set('isBuffered', this.elements.settingBuffered.checked);
        this.settings.set('crashOnSyncDrop', this.elements.settingCrashSync.checked);
        // Clamp maxLevel to min of 5 (lowest viable for pool trading)
        const maxLevel = Math.max(5, Math.min(100, parseInt(this.elements.settingMaxLevel.value) || 100));
        this.settings.set('maxLevel', maxLevel);
        this.elements.settingMaxLevel.value = maxLevel;
        this.elements.settingMaxLevelSlider.value = maxLevel;
        this.settings.set('convertToEggs', this.elements.settingConvertEggs.checked);

        this.applyTheme();
        this.log('Settings saved.');
        this.closeSettings();
    }

    resetToDefaults() {
        this.settings.resetToDefaults();
        this.loadSettingsToUI();
        this.log('Settings reset to defaults.');
    }

    updateDefaultIndicators() {
        const mappings = {
            'serverUrl': this.elements.settingServerUrl.value,
            'isJapanese': this.elements.settingJapanese.checked,
            'doSanityChecks': this.elements.settingSanityChecks.checked,
            'verbose': this.elements.settingVerbose.checked,
            'darkMode': this.elements.settingDarkMode.checked,
            'isBuffered': this.elements.settingBuffered.checked,
            'crashOnSyncDrop': this.elements.settingCrashSync.checked,
            'maxLevel': parseInt(this.elements.settingMaxLevel.value) || 100,
            'convertToEggs': this.elements.settingConvertEggs.checked
        };

        document.querySelectorAll('.default-indicator').forEach(indicator => {
            const settingKey = indicator.dataset.setting;
            if (settingKey && mappings.hasOwnProperty(settingKey)) {
                const currentValue = mappings[settingKey];
                const defaultValue = this.settings.getDefault(settingKey);
                const isDefault = currentValue === defaultValue;

                indicator.classList.toggle('is-default', isDefault);
                indicator.classList.toggle('not-default', !isDefault);
            }
        });
    }

    applyTheme() {
        const isDarkMode = this.settings.get('darkMode');
        // When darkMode is true, remove light-mode class (dark theme)
        // When darkMode is false, add light-mode class (light theme)
        document.body.classList.toggle('light-mode', !isDarkMode);
    }

    // === Generation and Trade Type Selection ===

    // Game versions for each generation
    static GAME_VERSIONS = {
        '1': 'Red, Blue, Green, Yellow',
        '2': 'Gold, Silver, Crystal',
        '3': 'Fire Red, Leaf Green, Ruby, Sapphire, Emerald - Requires Multiboot'
    };

    onGenSelect(btn) {
        // Update button states
        this.elements.genSelectGroup.querySelectorAll('.btn-option').forEach(b => {
            b.classList.remove('selected');
        });
        btn.classList.add('selected');

        // Store selection
        this.selectedGen = btn.dataset.value;

        // Show trade type options
        this.elements.tradeTypeGroup.style.display = 'block';

        // Update game versions display
        this.elements.gameVersions.textContent = AppUI.GAME_VERSIONS[this.selectedGen] || '';

        // Show/hide time capsule button for Gen 2
        this.elements.btnTimeCapsule.style.display = (this.selectedGen === '2') ? 'inline-block' : 'none';

        // Reset time capsule when switching generations
        if (this.selectedGen !== '2') {
            this.isTimeCapsule = false;
            this.elements.btnTimeCapsule.classList.remove('active');
            this.elements.btnTimeCapsule.textContent = 'Time Capsule: OFF';
        }

        // Show/hide multiboot button for Gen 3
        this.elements.btnSendMultiboot.style.display = (this.selectedGen === '3') ? 'inline-block' : 'none';

        // Update room code visibility based on current trade type
        this.updateRoomCodeVisibility();
    }

    onTradeTypeSelect(btn) {
        // Update button states
        this.elements.tradeTypeSelectGroup.querySelectorAll('.btn-option').forEach(b => {
            b.classList.remove('selected');
        });
        btn.classList.add('selected');

        // Store selection
        this.selectedTradeType = btn.dataset.value;

        // Update room code visibility
        this.updateRoomCodeVisibility();
    }

    updateRoomCodeVisibility() {
        const isLinkTrade = (this.selectedTradeType === 'link');
        this.elements.roomCodeGroup.style.display = isLinkTrade ? 'flex' : 'none';
    }

    toggleTimeCapsule() {
        this.isTimeCapsule = !this.isTimeCapsule;
        this.elements.btnTimeCapsule.classList.toggle('active', this.isTimeCapsule);
        this.elements.btnTimeCapsule.textContent = this.isTimeCapsule ? 'Time Capsule: ON' : 'Time Capsule: OFF';
    }

    async sendMultiboot() {
        if (!this.usb.isConnected) {
            this.log('Please connect USB first.');
            return;
        }

        this.log('═'.repeat(40));
        this.log('Starting GBA Multiboot Transfer');
        this.log('═'.repeat(40));

        // GBA multiboot requires 3.3V
        await this.usb.setVoltage('3v3');

        try {
            const response = await fetch('./data/pokemon_gen3_to_genx_mb.gba');
            if (!response.ok) {
                this.log(`Failed to load ROM file: ${response.status}`);
                return;
            }
            const romData = await response.arrayBuffer();
            this.log(`ROM loaded: ${romData.byteLength} bytes`);

            const success = await multiboot(this.usb, romData, (msg) => this.log(msg));
            if (success) {
                this.log('Multiboot transfer complete!');
            } else {
                this.log('Multiboot transfer failed.');
            }
        } catch (e) {
            this.log(`Multiboot error: ${e.message}`);
        }
    }

    generateRoomCode() {
        const code = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        this.elements.roomCode.value = code;
        this.log(`Generated room code: ${code}`);
    }

    /**
     * Show negotiation popup and wait for user decision.
     * @param {string} peerMode - The mode the other player wants (e.g., "Buffered" or "Synchronous")
     * @returns {Promise<boolean>} - Resolves to true if user agrees to switch, false if they refuse
     */
    showNegotiationPrompt(peerMode) {
        return new Promise((resolve) => {
            // Update message
            this.elements.negotiationMessage.textContent =
                `The other player wants to do a ${peerMode} trade.`;

            // Show popup
            this.elements.negotiationPopup.style.display = 'block';

            // Set up one-time click handlers
            const handleYes = () => {
                this.elements.negotiationPopup.style.display = 'none';
                this.elements.btnNegotiateYes.removeEventListener('click', handleYes);
                this.elements.btnNegotiateNo.removeEventListener('click', handleNo);
                this.log('User agreed to switch modes');
                resolve(true);
            };

            const handleNo = () => {
                this.elements.negotiationPopup.style.display = 'none';
                this.elements.btnNegotiateYes.removeEventListener('click', handleYes);
                this.elements.btnNegotiateNo.removeEventListener('click', handleNo);
                this.log('User refused to switch modes');
                resolve(false);
            };

            this.elements.btnNegotiateYes.addEventListener('click', handleYes);
            this.elements.btnNegotiateNo.addEventListener('click', handleNo);
        });
    }

    // === Logging ===

    log(msg) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        this.elements.logContainer.appendChild(entry);
        this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;

        // Also log to console if verbose
        if (this.settings.get('verbose')) {
            console.log(msg);
        }
    }

    // === Connection ===

    async connectServer() {
        try {
            // Validate generation is selected
            if (!this.selectedGen) {
                this.log('Please select a generation first.');
                return false;
            }

            let url = this.settings.get('serverUrl');
            const gen = this.selectedGen;
            const tradeType = this.selectedTradeType;

            if (url.endsWith('/')) {
                url = url.slice(0, -1);
            }

            if (tradeType === "pool") {
                // Time Capsule uses Gen 1 endpoints
                const serverGen = this.isTimeCapsule ? "1" : gen;
                url += `/pool${serverGen}`;
            } else {
                let roomCode = this.elements.roomCode.value.trim();
                if (!/^\d{1,5}$/.test(roomCode)) {
                    this.log("Invalid room code. Please enter 1-5 digits or click Generate.");
                    return false;
                }
                roomCode = roomCode.padStart(5, '0');
                // Time Capsule uses Gen 1 endpoints
                const serverGen = this.isTimeCapsule ? "1" : gen;
                url += `/link${serverGen}/${roomCode}`;
            }

            this.log(`Connecting to server at ${url}...`);
            await this.ws.connect(url);
            return true;
        } catch (error) {
            this.log(`Server connection failed: ${error}`);
            return false;
        }
    }

    async connectUsb() {
        try {
            this.log("Requesting USB device...");
            await this.usb.connect();

            this.elements.usbStatus.textContent = "Connected";
            this.elements.usbStatus.className = "status connected";
            this.elements.btnConnectUsb.disabled = true;
            this.checkReady();
        } catch (error) {
            this.log(`USB connection failed: ${error}`);
        }
    }

    checkReady() {
        if (this.usb.isConnected) {
            this.elements.btnStartTrade.disabled = false;
        }
    }

    // === Trading ===

    async startTrade() {
        // If trade is active, this acts as stop button
        if (this.isTradeActive) {
            await this.stopTrade();
            return;
        }

        this.elements.btnStartTrade.disabled = true;

        const connected = await this.connectServer();
        if (!connected) {
            this.elements.btnStartTrade.disabled = false;
            return;
        }

        // Switch button to Stop mode
        this.isTradeActive = true;
        this.elements.btnStartTrade.textContent = 'Stop Trade';
        this.elements.btnStartTrade.disabled = false;

        const gen = this.selectedGen;
        const tradeType = this.selectedTradeType;
        const isBuffered = this.settings.get('isBuffered');
        const doSanityChecks = this.settings.get('doSanityChecks');

        this.log(`Starting ${tradeType} trade for Gen ${gen} (${isBuffered ? 'buffered' : 'sync'} mode)...`);

        // Set voltage based on generation (only if firmware supports it)
        if (gen === "3") {
            await this.usb.setVoltage('3v3');
        } else {
            await this.usb.setVoltage('5v');
        }

        if (gen === "1") {
            this.protocol = new RBYTrading(
                this.usb,
                this.ws,
                (msg) => this.log(msg),
                tradeType,
                isBuffered,
                doSanityChecks,
                {
                    isJapanese: this.settings.get('isJapanese'),
                    verbose: this.settings.get('verbose'),
                    maxLevel: this.settings.get('maxLevel'),
                    crashOnSyncDrop: this.settings.get('crashOnSyncDrop'),
                    negotiationPrompt: (peerMode) => this.showNegotiationPrompt(peerMode)
                }
            );
        } else if (gen === "2") {
            // Gen 2 - but Time Capsule uses Gen 1 protocol
            if (this.isTimeCapsule) {
                this.log('Time Capsule mode: Using Gen 1 protocol');
                this.protocol = new RBYTrading(
                    this.usb,
                    this.ws,
                    (msg) => this.log(msg),
                    tradeType,
                    isBuffered,
                    doSanityChecks,
                    {
                        isJapanese: this.settings.get('isJapanese'),
                        verbose: this.settings.get('verbose'),
                        maxLevel: this.settings.get('maxLevel'),
                        crashOnSyncDrop: this.settings.get('crashOnSyncDrop'),
                        negotiationPrompt: (peerMode) => this.showNegotiationPrompt(peerMode)
                    }
                );
            } else {
                this.protocol = new GSCTrading(
                    this.usb,
                    this.ws,
                    (msg) => this.log(msg),
                    tradeType,
                    isBuffered,
                    doSanityChecks,
                    {
                        isJapanese: this.settings.get('isJapanese'),
                        verbose: this.settings.get('verbose'),
                        crashOnSyncDrop: this.settings.get('crashOnSyncDrop'),
                        maxLevel: this.settings.get('maxLevel'),
                        convertToEggs: this.settings.get('convertToEggs'),
                        negotiationPrompt: (peerMode) => this.showNegotiationPrompt(peerMode)
                    }
                );
            }
        } else if (gen === "3") {
            // Gen 3 trading requires multiboot first
            this.protocol = new RSESPTrading(
                this.usb,
                this.ws,
                (msg) => this.log(msg),
                tradeType,
                isBuffered,
                doSanityChecks,
                {
                    verbose: this.settings.get('verbose')
                }
            );
        }

        try {
            await this.protocol.startTrade();
        } catch (error) {
            this.log(`Trade error: ${error}`);
        } finally {
            // Reset button to Start mode when trade ends
            this.resetTradeButton();
        }
    }

    /**
     * Stop the current trade and clean up connections
     */
    async stopTrade() {
        this.log('Stopping trade...');

        // Stop the protocol if running
        if (this.protocol) {
            this.protocol.stopTrade = true;
        }

        // Disconnect WebSocket
        if (this.ws && this.ws.isConnected) {
            this.ws.disconnect();
        }

        // Reset button
        this.resetTradeButton();

        this.log('Trade stopped. You can start a new trade.');
    }

    /**
     * Reset the Start/Stop Trade button to default state
     */
    resetTradeButton() {
        this.isTradeActive = false;
        this.elements.btnStartTrade.textContent = 'Start Trade';
        this.elements.btnStartTrade.disabled = false;
    }
}

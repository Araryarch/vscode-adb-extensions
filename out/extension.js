"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const avdManager_1 = require("./avdManager");
// ─────────────────────────────────────────────────────────────────────────────
// Tree Item
// ─────────────────────────────────────────────────────────────────────────────
class AvdTreeItem extends vscode.TreeItem {
    constructor(avd, context) {
        super(avd.name, vscode.TreeItemCollapsibleState.None);
        this.avd = avd;
        this.context = context;
        this.tooltip = `${avd.name} — ${avd.status}`;
        this.description = avd.status === 'running' ? '● Running' : '○ Stopped';
        // contextValue drives menu "when" clauses
        this.contextValue = avd.status === 'running' ? 'avd-running' : 'avd-stopped';
        // Icon: use built-in ThemeIcons so we don't need extra image files
        this.iconPath =
            avd.status === 'running'
                ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'))
                : new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
        // Single-click → run emulator (only when stopped)
        if (avd.status === 'stopped') {
            this.command = {
                command: 'vsAndroidRunner.runAvd',
                title: 'Run Emulator',
                arguments: [this],
            };
        }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// TreeView Data Provider
// ─────────────────────────────────────────────────────────────────────────────
class AvdTreeDataProvider {
    constructor(extensionContext, getSdkPaths) {
        this.extensionContext = extensionContext;
        this.getSdkPaths = getSdkPaths;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.avds = [];
        this.loading = false;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren() {
        const paths = this.getSdkPaths();
        if (!paths) {
            return [];
        }
        if (!this.loading) {
            this.loading = true;
            try {
                this.avds = await (0, avdManager_1.listAvds)(paths);
            }
            catch (err) {
                vscode.window.showErrorMessage(`VS Android Runner: Failed to list AVDs — ${String(err)}`);
                this.avds = [];
            }
            finally {
                this.loading = false;
            }
        }
        if (this.avds.length === 0) {
            return [];
        }
        return this.avds.map((avd) => new AvdTreeItem(avd, this.extensionContext));
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Extension Activation
// ─────────────────────────────────────────────────────────────────────────────
let autoRefreshTimer;
function activate(context) {
    // ── Resolve SDK at startup ──────────────────────────────────────────────
    let sdkPaths;
    function tryResolveSdk(showError = true) {
        const config = vscode.workspace.getConfiguration('vsAndroidRunner');
        const override = config.get('sdkPath', '');
        try {
            sdkPaths = (0, avdManager_1.resolveSdkPaths)(override || undefined);
        }
        catch (err) {
            sdkPaths = undefined;
            if (showError) {
                vscode.window
                    .showErrorMessage(`VS Android Runner: ${String(err)}`, 'Open Settings', 'Install SDK')
                    .then((choice) => {
                    if (choice === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'vsAndroidRunner.sdkPath');
                    }
                    else if (choice === 'Install SDK') {
                        vscode.env.openExternal(vscode.Uri.parse('https://developer.android.com/studio/command-line'));
                    }
                });
            }
        }
    }
    tryResolveSdk(false); // silent on first try — user may not have Android installed
    // Re-resolve whenever the setting changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vsAndroidRunner')) {
            tryResolveSdk();
            provider.refresh();
            restartAutoRefresh();
        }
    }));
    // ── Tree View ───────────────────────────────────────────────────────────
    const provider = new AvdTreeDataProvider(context, () => sdkPaths);
    const treeView = vscode.window.createTreeView('vsAndroidRunner.avdList', {
        treeDataProvider: provider,
        showCollapseAll: false,
    });
    // Show a welcome message when there are no items
    treeView.message = undefined;
    context.subscriptions.push(treeView);
    // ── Auto-refresh ────────────────────────────────────────────────────────
    function restartAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = undefined;
        }
        const config = vscode.workspace.getConfiguration('vsAndroidRunner');
        const intervalSec = config.get('autoRefreshInterval', 10);
        if (intervalSec > 0) {
            autoRefreshTimer = setInterval(() => {
                provider.refresh();
            }, intervalSec * 1000);
        }
    }
    restartAutoRefresh();
    context.subscriptions.push({
        dispose: () => {
            if (autoRefreshTimer) {
                clearInterval(autoRefreshTimer);
            }
        },
    });
    // ── Command: Refresh ────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('vsAndroidRunner.refresh', () => {
        provider.refresh();
    }));
    // ── Command: Create AVD ─────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('vsAndroidRunner.createAvd', () => {
        const terminal = vscode.window.createTerminal({
            name: 'Create AVD',
            message: '⚡ VS Android Runner — use the avdmanager below to create a new AVD.\n' +
                '   Example: avdmanager create avd -n MyDevice -k "system-images;android-34;google_apis;x86_64"',
        });
        terminal.show();
        if (sdkPaths) {
            terminal.sendText(`"${sdkPaths.avdmanager}" list avd`);
        }
    }));
    // ── Command: Run AVD ────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('vsAndroidRunner.runAvd', async (item) => {
        const avdName = await resolveAvdName(item, sdkPaths);
        if (!avdName || !sdkPaths) {
            return;
        }
        try {
            (0, avdManager_1.runAvd)(sdkPaths, avdName);
            vscode.window.showInformationMessage(`🚀 Launching emulator: ${avdName}`);
            // Refresh after a small delay so status updates
            setTimeout(() => provider.refresh(), 5000);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to start AVD: ${String(err)}`);
        }
    }));
    // ── Command: Cold Boot ──────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('vsAndroidRunner.coldBootAvd', async (item) => {
        const avdName = await resolveAvdName(item, sdkPaths);
        if (!avdName || !sdkPaths) {
            return;
        }
        try {
            (0, avdManager_1.runAvd)(sdkPaths, avdName, true /* cold boot */);
            vscode.window.showInformationMessage(`❄️ Cold-booting emulator: ${avdName}`);
            setTimeout(() => provider.refresh(), 5000);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to cold-boot AVD: ${String(err)}`);
        }
    }));
    // ── Command: Stop AVD ───────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('vsAndroidRunner.stopAvd', async (item) => {
        if (!sdkPaths) {
            showSdkMissingError();
            return;
        }
        const avd = item?.avd;
        if (!avd || avd.status !== 'running' || !avd.serial) {
            vscode.window.showWarningMessage('VS Android Runner: No running emulator selected.');
            return;
        }
        try {
            (0, avdManager_1.stopAvd)(sdkPaths, avd.serial);
            vscode.window.showInformationMessage(`🛑 Stopping emulator: ${avd.name}`);
            setTimeout(() => provider.refresh(), 3000);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to stop emulator: ${String(err)}`);
        }
    }));
    // ── Command: Show Logcat ─────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('vsAndroidRunner.showLogcat', (item) => {
        if (!sdkPaths) {
            showSdkMissingError();
            return;
        }
        const avd = item?.avd;
        if (!avd || avd.status !== 'running' || !avd.serial) {
            vscode.window.showWarningMessage('VS Android Runner: Please select a running emulator.');
            return;
        }
        const { cmd, args } = (0, avdManager_1.buildLogcatArgs)(sdkPaths, avd.serial);
        const terminal = vscode.window.createTerminal({
            name: `Logcat — ${avd.name}`,
            message: `📋 Logcat stream for ${avd.name} (${avd.serial})`,
        });
        terminal.show();
        terminal.sendText(`"${cmd}" ${args.map(a => `"${a}"`).join(' ')}`);
    }));
    // ── Command: Set SDK Path ────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('vsAndroidRunner.setSdkPath', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'vsAndroidRunner.sdkPath');
    }));
    // ── Show SDK status in status bar ────────────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'vsAndroidRunner.refresh';
    updateStatusBar(statusBarItem, sdkPaths);
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // Keep status bar updated when config changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        updateStatusBar(statusBarItem, sdkPaths);
    }));
}
function deactivate() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function resolveAvdName(item, sdkPaths) {
    if (!sdkPaths) {
        showSdkMissingError();
        return undefined;
    }
    // If triggered from context menu the item is provided
    if (item?.avd?.name) {
        return item.avd.name;
    }
    // If triggered from command palette, prompt the user
    try {
        const avds = await (0, avdManager_1.listAvds)(sdkPaths);
        if (avds.length === 0) {
            vscode.window.showInformationMessage('No AVDs found. Create one first with the "Create New AVD" button.');
            return undefined;
        }
        const picked = await vscode.window.showQuickPick(avds.map((a) => ({
            label: a.name,
            description: a.status === 'running' ? '● Running' : '○ Stopped',
            avd: a,
        })), { placeHolder: 'Select an AVD to launch' });
        return picked?.label;
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to list AVDs: ${String(err)}`);
        return undefined;
    }
}
function showSdkMissingError() {
    vscode.window
        .showErrorMessage('Android SDK not found. Please configure vsAndroidRunner.sdkPath.', 'Open Settings')
        .then((choice) => {
        if (choice === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'vsAndroidRunner.sdkPath');
        }
    });
}
function updateStatusBar(item, sdkPaths) {
    if (sdkPaths) {
        item.text = '$(device-mobile) Android Runner';
        item.tooltip = `SDK: ${sdkPaths.sdkRoot}\nClick to refresh AVD list`;
        item.backgroundColor = undefined;
    }
    else {
        item.text = '$(warning) Android SDK not found';
        item.tooltip = 'Click to refresh after configuring SDK path';
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}
//# sourceMappingURL=extension.js.map
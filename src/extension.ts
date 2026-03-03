import * as vscode from 'vscode';
import * as path from 'path';
import {
  AvdInfo,
  SdkPaths,
  buildLogcatArgs,
  listAvds,
  resolveSdkPaths,
  runAvd,
  stopAvd,
} from './avdManager';

// ─────────────────────────────────────────────────────────────────────────────
// Tree Item
// ─────────────────────────────────────────────────────────────────────────────

class AvdTreeItem extends vscode.TreeItem {
  constructor(
    public readonly avd: AvdInfo,
    private readonly context: vscode.ExtensionContext
  ) {
    super(avd.name, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${avd.name} — ${avd.status}`;
    this.description = avd.status === 'running' ? '● Running' : '○ Stopped';

    // contextValue drives menu "when" clauses
    this.contextValue = avd.status === 'running' ? 'avd-running' : 'avd-stopped';

    // Icon: use built-in ThemeIcons so we don't need extra image files
    this.iconPath =
      avd.status === 'running'
        ? new vscode.ThemeIcon(
            'circle-filled',
            new vscode.ThemeColor('charts.green')
          )
        : new vscode.ThemeIcon(
            'circle-outline',
            new vscode.ThemeColor('disabledForeground')
          );

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

class AvdTreeDataProvider
  implements vscode.TreeDataProvider<AvdTreeItem>
{
  private _onDidChangeTreeData =
    new vscode.EventEmitter<AvdTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private avds: AvdInfo[] = [];
  private loading = false;

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private getSdkPaths: () => SdkPaths | undefined
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AvdTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<AvdTreeItem[]> {
    const paths = this.getSdkPaths();
    if (!paths) {
      return [];
    }

    if (!this.loading) {
      this.loading = true;
      try {
        this.avds = await listAvds(paths);
      } catch (err) {
        vscode.window.showErrorMessage(
          `VS Android Runner: Failed to list AVDs — ${String(err)}`
        );
        this.avds = [];
      } finally {
        this.loading = false;
      }
    }

    if (this.avds.length === 0) {
      return [];
    }

    return this.avds.map(
      (avd) => new AvdTreeItem(avd, this.extensionContext)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Activation
// ─────────────────────────────────────────────────────────────────────────────

let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // ── Resolve SDK at startup ──────────────────────────────────────────────
  let sdkPaths: SdkPaths | undefined;

  function tryResolveSdk(showError = true): void {
    const config = vscode.workspace.getConfiguration('vsAndroidRunner');
    const override: string = config.get<string>('sdkPath', '');
    try {
      sdkPaths = resolveSdkPaths(override || undefined);
    } catch (err) {
      sdkPaths = undefined;
      if (showError) {
        vscode.window
          .showErrorMessage(
            `VS Android Runner: ${String(err)}`,
            'Open Settings',
            'Install SDK'
          )
          .then((choice) => {
            if (choice === 'Open Settings') {
              vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'vsAndroidRunner.sdkPath'
              );
            } else if (choice === 'Install SDK') {
              vscode.env.openExternal(
                vscode.Uri.parse(
                  'https://developer.android.com/studio/command-line'
                )
              );
            }
          });
      }
    }
  }

  tryResolveSdk(false); // silent on first try — user may not have Android installed

  // Re-resolve whenever the setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('vsAndroidRunner')) {
        tryResolveSdk();
        provider.refresh();
        restartAutoRefresh();
      }
    })
  );

  // ── Tree View ───────────────────────────────────────────────────────────
  const provider = new AvdTreeDataProvider(
    context,
    () => sdkPaths
  );

  const treeView = vscode.window.createTreeView('vsAndroidRunner.avdList', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  // Show a welcome message when there are no items
  treeView.message = undefined;

  context.subscriptions.push(treeView);

  // ── Auto-refresh ────────────────────────────────────────────────────────
  function restartAutoRefresh(): void {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = undefined;
    }
    const config = vscode.workspace.getConfiguration('vsAndroidRunner');
    const intervalSec = config.get<number>('autoRefreshInterval', 10);
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
  context.subscriptions.push(
    vscode.commands.registerCommand('vsAndroidRunner.refresh', () => {
      provider.refresh();
    })
  );

  // ── Command: Create AVD ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('vsAndroidRunner.createAvd', () => {
      const terminal = vscode.window.createTerminal({
        name: 'Create AVD',
        message:
          '⚡ VS Android Runner — use the avdmanager below to create a new AVD.\n' +
          '   Example: avdmanager create avd -n MyDevice -k "system-images;android-34;google_apis;x86_64"',
      });
      terminal.show();
      if (sdkPaths) {
        terminal.sendText(`"${sdkPaths.avdmanager}" list avd`);
      }
    })
  );

  // ── Command: Run AVD ────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vsAndroidRunner.runAvd',
      async (item?: AvdTreeItem) => {
        const avdName = await resolveAvdName(item, sdkPaths);
        if (!avdName || !sdkPaths) {
          return;
        }
        try {
          runAvd(sdkPaths, avdName);
          vscode.window.showInformationMessage(
            `🚀 Launching emulator: ${avdName}`
          );
          // Refresh after a small delay so status updates
          setTimeout(() => provider.refresh(), 5000);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to start AVD: ${String(err)}`);
        }
      }
    )
  );

  // ── Command: Cold Boot ──────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vsAndroidRunner.coldBootAvd',
      async (item?: AvdTreeItem) => {
        const avdName = await resolveAvdName(item, sdkPaths);
        if (!avdName || !sdkPaths) {
          return;
        }
        try {
          runAvd(sdkPaths, avdName, true /* cold boot */);
          vscode.window.showInformationMessage(
            `❄️ Cold-booting emulator: ${avdName}`
          );
          setTimeout(() => provider.refresh(), 5000);
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to cold-boot AVD: ${String(err)}`
          );
        }
      }
    )
  );

  // ── Command: Stop AVD ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vsAndroidRunner.stopAvd',
      async (item?: AvdTreeItem) => {
        if (!sdkPaths) {
          showSdkMissingError();
          return;
        }
        const avd = item?.avd;
        if (!avd || avd.status !== 'running' || !avd.serial) {
          vscode.window.showWarningMessage(
            'VS Android Runner: No running emulator selected.'
          );
          return;
        }
        try {
          stopAvd(sdkPaths, avd.serial);
          vscode.window.showInformationMessage(
            `🛑 Stopping emulator: ${avd.name}`
          );
          setTimeout(() => provider.refresh(), 3000);
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to stop emulator: ${String(err)}`
          );
        }
      }
    )
  );

  // ── Command: Show Logcat ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vsAndroidRunner.showLogcat',
      (item?: AvdTreeItem) => {
        if (!sdkPaths) {
          showSdkMissingError();
          return;
        }
        const avd = item?.avd;
        if (!avd || avd.status !== 'running' || !avd.serial) {
          vscode.window.showWarningMessage(
            'VS Android Runner: Please select a running emulator.'
          );
          return;
        }
        const { cmd, args } = buildLogcatArgs(sdkPaths, avd.serial);
        const terminal = vscode.window.createTerminal({
          name: `Logcat — ${avd.name}`,
          message: `📋 Logcat stream for ${avd.name} (${avd.serial})`,
        });
        terminal.show();
        terminal.sendText(`"${cmd}" ${args.map(a => `"${a}"`).join(' ')}`);
      }
    )
  );

  // ── Command: Set SDK Path ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('vsAndroidRunner.setSdkPath', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'vsAndroidRunner.sdkPath'
      );
    })
  );

  // ── Show SDK status in status bar ────────────────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'vsAndroidRunner.refresh';
  updateStatusBar(statusBarItem, sdkPaths);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Keep status bar updated when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(() => {
      updateStatusBar(statusBarItem, sdkPaths);
    })
  );
}

export function deactivate(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveAvdName(
  item: AvdTreeItem | undefined,
  sdkPaths: SdkPaths | undefined
): Promise<string | undefined> {
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
    const avds = await listAvds(sdkPaths);
    if (avds.length === 0) {
      vscode.window.showInformationMessage(
        'No AVDs found. Create one first with the "Create New AVD" button.'
      );
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      avds.map((a) => ({
        label: a.name,
        description: a.status === 'running' ? '● Running' : '○ Stopped',
        avd: a,
      })),
      { placeHolder: 'Select an AVD to launch' }
    );
    return picked?.label;
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to list AVDs: ${String(err)}`);
    return undefined;
  }
}

function showSdkMissingError(): void {
  vscode.window
    .showErrorMessage(
      'Android SDK not found. Please configure vsAndroidRunner.sdkPath.',
      'Open Settings'
    )
    .then((choice) => {
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'vsAndroidRunner.sdkPath'
        );
      }
    });
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  sdkPaths: SdkPaths | undefined
): void {
  if (sdkPaths) {
    item.text = '$(device-mobile) Android Runner';
    item.tooltip = `SDK: ${sdkPaths.sdkRoot}\nClick to refresh AVD list`;
    item.backgroundColor = undefined;
  } else {
    item.text = '$(warning) Android SDK not found';
    item.tooltip = 'Click to refresh after configuring SDK path';
    item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
  }
}

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
import { AndroidXmlPreviewPanel } from './xmlPreview';
import { runNewProjectWizard } from './projectWizard';
import {
  detectFlutter,
  runFlutterInTerminal,
  FlutterDeviceProvider,
  FlutterActionProvider,
  FlutterDeviceItem,
} from './flutterManager';
import { runFlutterProjectWizard } from './flutterWizard';
import { runAndroidApp } from './gradleRunner';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tree Item
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class AvdTreeItem extends vscode.TreeItem {
  constructor(
    public readonly avd: AvdInfo,
    private readonly context: vscode.ExtensionContext
  ) {
    super(avd.name, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${avd.name} â€” ${avd.status}`;
    this.description = avd.status === 'running' ? 'â— Running' : 'â—‹ Stopped';

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

    // Single-click â†’ run emulator (only when stopped)
    if (avd.status === 'stopped') {
      this.command = {
        command: 'vsAndroidRunner.runAvd',
        title: 'Run Emulator',
        arguments: [this],
      };
    }
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TreeView Data Provider
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
          `VS Android Runner: Failed to list AVDs â€” ${String(err)}`
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Extension Activation
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // â”€â”€ Resolve SDK at startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let sdkPaths: SdkPaths | undefined;

  // â”€â”€ Flutter Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let flutterExe: string | undefined = detectFlutter();
  const flutterDeviceProvider = new FlutterDeviceProvider(() => flutterExe);
  const flutterActionProvider = new FlutterActionProvider();

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

  tryResolveSdk(false); // silent on first try â€” user may not have Android installed

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

  // â”€â”€ Tree View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Flutter TreeViews â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const flutterDeviceView = vscode.window.createTreeView('droidStudio.flutterDevices', {
    treeDataProvider: flutterDeviceProvider,
    showCollapseAll: false,
  });
  const flutterActionView = vscode.window.createTreeView('droidStudio.flutterActions', {
    treeDataProvider: flutterActionProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(flutterDeviceView, flutterActionView);

  // â”€â”€ Auto-refresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function restartAutoRefresh(): void {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = undefined; }
    const config = vscode.workspace.getConfiguration('vsAndroidRunner');
    const intervalSec = config.get<number>('autoRefreshInterval', 10);
    if (intervalSec > 0) {
      autoRefreshTimer = setInterval(() => {
        provider.refresh();
        flutterDeviceProvider.refresh();
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
      // Also refresh the Flutter list
      flutterDeviceProvider.refresh();
    })
  );

  // â”€â”€ Command: New Android Project â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.newProject', () => {
      runNewProjectWizard();
    })
  );

  // â”€â”€ Command: Run App (Gradle â†’ Emulator â†’ Install â†’ Launch) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.runApp', async () => {
      if (!sdkPaths) {
        // Try once more before giving up
        tryResolveSdk(true);
        if (!sdkPaths) { return; }
      }
      await runAndroidApp(sdkPaths);
    })
  );

  // â”€â”€ Command: Create AVD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('vsAndroidRunner.createAvd', () => {
      const terminal = vscode.window.createTerminal({
        name: 'Create AVD',
        message:
          'âš¡ VS Android Runner â€” use the avdmanager below to create a new AVD.\n' +
          '   Example: avdmanager create avd -n MyDevice -k "system-images;android-34;google_apis;x86_64"',
      });
      terminal.show();
      if (sdkPaths) {
        terminal.sendText(`"${sdkPaths.avdmanager}" list avd`);
      }
    })
  );

  // â”€â”€ Command: Run AVD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            `ðŸš€ Launching emulator: ${avdName}`
          );
          // Refresh after a small delay so status updates
          setTimeout(() => provider.refresh(), 5000);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to start AVD: ${String(err)}`);
        }
      }
    )
  );

  // â”€â”€ Command: Cold Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            `â„ï¸ Cold-booting emulator: ${avdName}`
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

  // â”€â”€ Command: Stop AVD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            `ðŸ›‘ Stopping emulator: ${avd.name}`
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

  // â”€â”€ Command: Show Logcat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          name: `Logcat â€” ${avd.name}`,
          message: `ðŸ“‹ Logcat stream for ${avd.name} (${avd.serial})`,
        });
        terminal.show();
        terminal.sendText(`"${cmd}" ${args.map(a => `"${a}"`).join(' ')}`);
      }
    )
  );

  // â”€â”€ Command: Set SDK Path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('vsAndroidRunner.setSdkPath', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'vsAndroidRunner.sdkPath'
      );
    })
  );

  // â”€â”€ Command: XML Layout Preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.previewXml', () => {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document.languageId === 'xml'
        ? editor.document.uri
        : undefined;
      AndroidXmlPreviewPanel.createOrShow(context.extensionUri, uri);
    })
  );

  // â”€â”€ Flutter: helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function requireFlutter(): string | undefined {
    if (!flutterExe) {
      flutterExe = detectFlutter(); // re-try in case PATH changed
    }
    if (!flutterExe) {
      vscode.window
        .showErrorMessage('Flutter SDK not found. Install Flutter and ensure it is on PATH.', 'Get Flutter')
        .then(c => { if (c) { vscode.env.openExternal(vscode.Uri.parse('https://flutter.dev/docs/get-started/install')); } });
      return undefined;
    }
    return flutterExe;
  }

  // â”€â”€ Flutter: run on selected device â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterRun', async (item?: FlutterDeviceItem) => {
      const fl = requireFlutter(); if (!fl) { return; }
      const deviceId = item?.device.id;
      const args = deviceId ? ['run', '-d', deviceId] : ['run'];
      runFlutterInTerminal(fl, args, `Flutter Run${deviceId ? ` â€” ${item!.device.name}` : ''}`);
    })
  );

  // â”€â”€ Flutter: run all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterRunAll', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['run'], 'Flutter Run');
    })
  );

  // â”€â”€ Flutter: pub get â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterPubGet', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['pub', 'get'], 'flutter pub get');
    })
  );

  // â”€â”€ Flutter: pub upgrade â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterPubUpgrade', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['pub', 'upgrade'], 'flutter pub upgrade');
    })
  );

  // â”€â”€ Flutter: clean â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterClean', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['clean'], 'flutter clean');
    })
  );

  // â”€â”€ Flutter: doctor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterDoctor', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['doctor', '-v'], 'flutter doctor');
    })
  );

  // â”€â”€ Flutter: analyze â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterAnalyze', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['analyze'], 'flutter analyze');
    })
  );

  // â”€â”€ Flutter: test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterTest', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['test'], 'flutter test');
    })
  );

  // â”€â”€ Flutter: build APK (debug) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterBuildApk', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['build', 'apk', '--debug'], 'Flutter Build APK');
    })
  );

  // â”€â”€ Flutter: build APK (release) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterBuildApkRelease', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['build', 'apk', '--release'], 'Flutter Build APK (Release)');
    })
  );

  // â”€â”€ Flutter: build AAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterBuildAab', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['build', 'appbundle', '--release'], 'Flutter Build AAB');
    })
  );

  // â”€â”€ Flutter: build Web â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterBuildWeb', () => {
      const fl = requireFlutter(); if (!fl) { return; }
      runFlutterInTerminal(fl, ['build', 'web'], 'Flutter Build Web');
    })
  );

  // â”€â”€ Flutter: new project wizard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterNew', async () => {
      const fl = requireFlutter(); if (!fl) { return; }
      await runFlutterProjectWizard(fl);
    })
  );

  // â”€â”€ Flutter: refresh devices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  context.subscriptions.push(
    vscode.commands.registerCommand('droidStudio.flutterRefresh', () => {
      flutterDeviceProvider.refresh();
    })
  );

  // Auto-open preview when an XML file is opened in the editor
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (
        editor &&
        editor.document.languageId === 'xml' &&
        editor.document.uri.fsPath.includes('res') &&
        editor.document.uri.fsPath.endsWith('.xml')
      ) {
        AndroidXmlPreviewPanel.createOrShow(context.extensionUri, editor.document.uri);
      }
    })
  );

  // â”€â”€ Show SDK status in status bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        description: a.status === 'running' ? 'â— Running' : 'â—‹ Stopped',
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
    item.text = '$(device-mobile) Droid Studio';
    item.tooltip = `Droid Studio â€” SDK: ${sdkPaths.sdkRoot}\nClick to refresh AVD list`;
    item.backgroundColor = undefined;
  } else {
    item.text = '$(warning) Droid Studio: SDK not found';
    item.tooltip = 'Click to configure Android SDK path';
    item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
  }
}

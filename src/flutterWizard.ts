import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

interface FlutterProjectConfig {
  name: string;
  org: string;
  platforms: string[];
  stateManagement: string;
  dir: string;
  flutter: string;
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export async function runFlutterProjectWizard(flutter: string): Promise<void> {
  // Step 1: Project name
  const name = await vscode.window.showInputBox({
    title: 'New Flutter Project — Step 1 of 4',
    prompt: 'Project Name (snake_case)',
    value: 'my_flutter_app',
    validateInput: v =>
      /^[a-z][a-z0-9_]*$/.test(v.trim())
        ? null
        : 'Must be lowercase snake_case (e.g. my_awesome_app)',
  });
  if (!name) { return; }

  // Step 2: Organization
  const org = await vscode.window.showInputBox({
    title: 'New Flutter Project — Step 2 of 4',
    prompt: 'Organization (reverse domain)',
    value: 'com.example',
    validateInput: v =>
      /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(v.trim())
        ? null
        : 'Invalid org (e.g. com.mycompany)',
  });
  if (!org) { return; }

  // Step 3: Platforms
  const platformPicks = await vscode.window.showQuickPick(
    [
      { label: '$(device-mobile) Android', picked: true, value: 'android' },
      { label: '$(device-mobile) iOS', picked: true, value: 'ios' },
      { label: '$(globe) Web', picked: false, value: 'web' },
      { label: '$(desktop-download) Windows', picked: false, value: 'windows' },
      { label: '$(desktop-download) Linux', picked: false, value: 'linux' },
      { label: '$(desktop-download) macOS', picked: false, value: 'macos' },
    ],
    {
      title: 'New Flutter Project — Step 3 of 4',
      placeHolder: 'Select target platforms (Space to toggle)',
      canPickMany: true,
    }
  );
  if (!platformPicks?.length) { return; }

  // Step 4: State management
  const statePick = await vscode.window.showQuickPick(
    [
      { label: '$(circle-outline) None', value: 'none', description: 'Vanilla Flutter (setState)' },
      { label: '$(extensions) Riverpod', value: 'riverpod', description: 'flutter_riverpod ^2.6.1' },
      { label: '$(symbol-class) Bloc', value: 'bloc', description: 'flutter_bloc ^8.1.4' },
      { label: '$(symbol-property) Provider', value: 'provider', description: 'provider ^6.1.2' },
      { label: '$(zap) GetX', value: 'getx', description: 'get ^4.6.6' },
    ],
    { title: 'New Flutter Project — Step 4 of 4', placeHolder: 'State management' }
  );
  if (!statePick) { return; }

  // Location Picker
  const uris = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false,
    openLabel: 'Create Project Here',
  });
  if (!uris?.[0]) { return; }

  const cfg: FlutterProjectConfig = {
    name,
    org,
    platforms: platformPicks.map(p => p.value),
    stateManagement: statePick.value,
    dir: path.join(uris[0].fsPath, name),
    flutter,
  };

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Creating Flutter project "${name}"…`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Running flutter create…' });
      await createFlutterProject(cfg);

      if (cfg.stateManagement !== 'none') {
        progress.report({ message: `Adding ${cfg.stateManagement} dependency…` });
        await addStateManagementDep(cfg);
      }
    }
  );

  const choice = await vscode.window.showInformationMessage(
    `✅ Flutter project "${name}" created!`,
    'Open Project', 'Open in New Window'
  );
  if (choice === 'Open Project') {
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cfg.dir));
  } else if (choice === 'Open in New Window') {
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(cfg.dir), true);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createFlutterProject(cfg: FlutterProjectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      'create',
      '--org', cfg.org,
      '--project-name', cfg.name,
      '--platforms', cfg.platforms.join(','),
      cfg.dir,
    ];
    const child = cp.spawn(`"${cfg.flutter}"`, args, {
      shell: process.platform === 'win32',
      stdio: 'pipe',
    });
    child.on('close', (code) => {
      if (code === 0) { resolve(); }
      else { reject(new Error(`flutter create exited with code ${code}`)); }
    });
    child.on('error', reject);
  });
}

function addStateManagementDep(cfg: FlutterProjectConfig): Promise<void> {
  const depMap: Record<string, string> = {
    riverpod: 'flutter_riverpod:^2.6.1',
    bloc: 'flutter_bloc:^8.1.4',
    provider: 'provider:^6.1.2',
    getx: 'get:^4.6.6',
  };
  const dep = depMap[cfg.stateManagement];
  if (!dep) { return Promise.resolve(); }

  // Modify pubspec.yaml to add dependency
  const pubspecPath = path.join(cfg.dir, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) { return Promise.resolve(); }

  let content = fs.readFileSync(pubspecPath, 'utf-8');
  const [pkgName, pkgVersion] = dep.split(':');
  const depLine = `  ${pkgName}: ${pkgVersion}`;

  // Insert after "  flutter:\n    sdk: flutter"
  content = content.replace(
    /(\s+flutter:\s*\n\s+sdk: flutter\n)/,
    `$1${depLine}\n`
  );
  fs.writeFileSync(pubspecPath, content, 'utf-8');

  // Also scaffold a basic file for the state management
  scaffoldStateManagement(cfg);

  // Run flutter pub get
  return new Promise((resolve) => {
    const opts: cp.ExecOptionsWithStringEncoding = { encoding: 'utf-8', cwd: cfg.dir };
    cp.exec(
      `"${cfg.flutter}" pub get`,
      opts,
      () => resolve() // ignore errors, user can run pub get manually
    );
  });
}

function scaffoldStateManagement(cfg: FlutterProjectConfig): void {
  const libDir = path.join(cfg.dir, 'lib');
  const providerDir = path.join(libDir, 'providers');
  fs.mkdirSync(providerDir, { recursive: true });

  const templates: Record<string, string> = {
    riverpod: `import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Example counter provider using Riverpod StateNotifier
class CounterNotifier extends StateNotifier<int> {
  CounterNotifier() : super(0);

  void increment() => state++;
  void decrement() => state--;
  void reset() => state = 0;
}

final counterProvider = StateNotifierProvider<CounterNotifier, int>(
  (ref) => CounterNotifier(),
);
`,
    bloc: `import 'package:bloc/bloc.dart';
import 'package:meta/meta.dart';

part 'counter_event.dart';
part 'counter_state.dart';

class CounterBloc extends Bloc<CounterEvent, CounterState> {
  CounterBloc() : super(CounterInitial()) {
    on<CounterIncrement>((event, emit) => emit(CounterUpdated(state.count + 1)));
    on<CounterDecrement>((event, emit) => emit(CounterUpdated(state.count - 1)));
  }
}
`,
    provider: `import 'package:flutter/material.dart';

/// Example counter model using Provider's ChangeNotifier
class CounterModel extends ChangeNotifier {
  int _count = 0;
  int get count => _count;

  void increment() { _count++; notifyListeners(); }
  void decrement() { _count--; notifyListeners(); }
  void reset() { _count = 0; notifyListeners(); }
}
`,
    getx: `import 'package:get/get.dart';

/// Example counter controller using GetX
class CounterController extends GetxController {
  final count = 0.obs;

  void increment() => count++;
  void decrement() => count--;
  void reset() => count.value = 0;
}
`,
  };

  const template = templates[cfg.stateManagement];
  if (template) {
    fs.writeFileSync(
      path.join(providerDir, 'counter_provider.dart'),
      template,
      'utf-8'
    );
  }
}

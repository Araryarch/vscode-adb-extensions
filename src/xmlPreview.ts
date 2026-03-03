import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ─── XML Types ───────────────────────────────────────────────────────────────

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

// ─── Simple XML Parser ───────────────────────────────────────────────────────

function parseXml(src: string): XmlNode | null {
  src = src
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  let pos = 0;

  function skip() {
    while (pos < src.length && /\s/.test(src[pos])) { pos++; }
  }

  function readUntil(chars: string): string {
    let out = '';
    while (pos < src.length && !chars.includes(src[pos])) { out += src[pos++]; }
    return out;
  }

  function parseNode(): XmlNode | null {
    skip();
    if (pos >= src.length || src[pos] !== '<') { return null; }
    pos++; // <
    if (src[pos] === '/' || src[pos] === '!') { return null; }

    const tag = readUntil(' \t\n\r/>');
    if (!tag) { return null; }

    const attrs: Record<string, string> = {};
    while (pos < src.length) {
      skip();
      if (src[pos] === '>' || (src[pos] === '/' && src[pos + 1] === '>')) { break; }
      const name = readUntil('= \t\n\r/>');
      if (!name) { pos++; continue; }
      skip();
      if (src[pos] === '=') {
        pos++;
        skip();
        const q = src[pos++];
        let val = '';
        while (pos < src.length && src[pos] !== q) { val += src[pos++]; }
        pos++;
        attrs[name] = val;
      }
    }

    const selfClose = src[pos] === '/';
    if (selfClose) { pos++; }
    if (src[pos] === '>') { pos++; }

    const node: XmlNode = { tag, attrs, children: [] };

    if (!selfClose) {
      while (pos < src.length) {
        skip();
        if (src[pos] === '<' && src[pos + 1] === '/') {
          while (pos < src.length && src[pos] !== '>') { pos++; }
          pos++;
          break;
        }
        const child = parseNode();
        if (child) { node.children.push(child); } else { break; }
      }
    }
    return node;
  }

  return parseNode();
}

// ─── Dimension / Color Helpers ───────────────────────────────────────────────

function dim(v: string | undefined): string {
  if (!v) { return 'auto'; }
  if (v === 'match_parent' || v === 'fill_parent') { return '100%'; }
  if (v === 'wrap_content') { return 'fit-content'; }
  const n = parseFloat(v);
  return isNaN(n) ? 'auto' : `${n}px`;
}

function color(v: string | undefined): string {
  if (!v) { return ''; }
  if (v.startsWith('#')) {
    if (v.length === 9) {
      const a = (parseInt(v.slice(1, 3), 16) / 255).toFixed(2);
      const r = parseInt(v.slice(3, 5), 16);
      const g = parseInt(v.slice(5, 7), 16);
      const b = parseInt(v.slice(7, 9), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    return v;
  }
  const map: Record<string, string> = {
    '@android:color/white': '#fff',
    '@android:color/black': '#000',
    '@android:color/transparent': 'transparent',
    '@color/white': '#fff', '@color/black': '#000',
    '@color/colorPrimary': '#6200EE',
    '@color/colorPrimaryDark': '#3700B3',
    '@color/colorAccent': '#03DAC5',
    '@color/md_theme_primary': '#6750A4',
  };
  return map[v] ?? '';
}

function pad(n: XmlNode): string {
  const all = n.attrs['android:padding'];
  if (all) { return `padding:${dim(all)};`; }
  const t = dim(n.attrs['android:paddingTop']);
  const b = dim(n.attrs['android:paddingBottom']);
  const l = dim(n.attrs['android:paddingLeft'] ?? n.attrs['android:paddingStart']);
  const r = dim(n.attrs['android:paddingRight'] ?? n.attrs['android:paddingEnd']);
  const vals = [t, r, b, l];
  return vals.every(x => x === 'auto') ? '' : `padding:${vals.map(x => x === 'auto' ? '0' : x).join(' ')};`;
}

function mar(n: XmlNode): string {
  const all = n.attrs['android:layout_margin'];
  if (all) { return `margin:${dim(all)};`; }
  const t = dim(n.attrs['android:layout_marginTop']);
  const b = dim(n.attrs['android:layout_marginBottom']);
  const l = dim(n.attrs['android:layout_marginLeft'] ?? n.attrs['android:layout_marginStart']);
  const r = dim(n.attrs['android:layout_marginRight'] ?? n.attrs['android:layout_marginEnd']);
  const vals = [t, r, b, l];
  return vals.every(x => x === 'auto') ? '' : `margin:${vals.map(x => x === 'auto' ? '0' : x).join(' ')};`;
}

function gravity(v: string | undefined, flex = true): string {
  if (!v) { return ''; }
  const p = v.split('|').map(s => s.trim());
  const styles: string[] = [];
  if (flex) {
    if (p.includes('center')) { styles.push('justify-content:center;align-items:center;'); }
    else {
      if (p.some(x => ['center_horizontal', 'center'].includes(x))) { styles.push('justify-content:center;'); }
      if (p.some(x => ['end', 'right'].includes(x))) { styles.push('justify-content:flex-end;'); }
      if (p.some(x => ['center_vertical'].includes(x))) { styles.push('align-items:center;'); }
      if (p.some(x => ['bottom'].includes(x))) { styles.push('align-items:flex-end;'); }
    }
  } else {
    if (p.includes('center') || p.includes('center_horizontal')) { styles.push('text-align:center;'); }
    if (p.some(x => ['end', 'right'].includes(x))) { styles.push('text-align:right;'); }
  }
  return styles.join('');
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function txt(v: string | undefined): string {
  if (!v) { return ''; }
  if (v.startsWith('@string/')) { return v.replace('@string/', '').replace(/_/g, ' '); }
  return v;
}

// ─── Node Renderer ───────────────────────────────────────────────────────────

function renderNode(node: XmlNode): string {
  const shortTag = node.tag.split('.').pop() ?? node.tag;
  const w = dim(node.attrs['android:layout_width']);
  const h = dim(node.attrs['android:layout_height']);
  const bg = color(node.attrs['android:background']);
  const vis = node.attrs['android:visibility'] === 'gone' ? 'display:none;' : '';
  const base = `box-sizing:border-box;width:${w};height:${h};${pad(node)}${mar(node)}${bg ? `background:${bg};` : ''}${vis}`;
  const kids = node.children.map(renderNode).join('');

  switch (shortTag) {
    case 'LinearLayout':
    case 'ScrollView':
    case 'NestedScrollView':
    case 'HorizontalScrollView': {
      const dir = node.attrs['android:orientation'] === 'horizontal' ? 'row' : 'column';
      const g = gravity(node.attrs['android:gravity']);
      return `<div style="${base}display:flex;flex-direction:${dir};${g}">${kids}</div>`;
    }
    case 'RelativeLayout':
    case 'ConstraintLayout':
    case 'CoordinatorLayout':
    case 'FrameLayout':
    case 'AppBarLayout': {
      return `<div style="${base}position:relative;">${kids}</div>`;
    }
    case 'TextView': {
      const t = txt(node.attrs['android:text'] ?? node.attrs['tools:text']);
      const size = parseFloat(node.attrs['android:textSize'] ?? '14') || 14;
      const c = color(node.attrs['android:textColor']) || 'var(--text-primary)';
      const bold = node.attrs['android:textStyle']?.includes('bold') ? 'font-weight:bold;' : '';
      const g = gravity(node.attrs['android:gravity'], false);
      return `<span style="${base}display:block;font-size:${size}px;color:${c};${bold}${g}">${esc(t) || '&nbsp;'}</span>`;
    }
    case 'Button':
    case 'MaterialButton':
    case 'AppCompatButton': {
      const t = txt(node.attrs['android:text']) || 'Button';
      return `<button class="a-btn" style="${base}">${esc(t)}</button>`;
    }
    case 'ImageButton': {
      return `<button class="a-btn icon-btn" style="${base}">🖼</button>`;
    }
    case 'EditText':
    case 'TextInputEditText':
    case 'AutoCompleteTextView': {
      const hint = txt(node.attrs['android:hint'] ?? node.attrs['android:text']);
      return `<input class="a-input" placeholder="${esc(hint)}" style="${base}">`;
    }
    case 'TextInputLayout': {
      return `<div class="a-input-layout" style="${base}">${kids}</div>`;
    }
    case 'ImageView':
    case 'AppCompatImageView':
    case 'ShapeableImageView': {
      const src = node.attrs['android:src'] ?? node.attrs['app:srcCompat'] ?? '';
      const label = src.replace('@drawable/', '').replace('@mipmap/', '');
      const scaleType = node.attrs['android:scaleType'] ?? 'centerCrop';
      const fit = scaleType === 'centerCrop' ? 'cover' : scaleType === 'fitXY' ? '100% 100%' : 'contain';
      return `<div class="a-image" style="${base}object-fit:${fit};" title="${label}">🖼<br><small>${label}</small></div>`;
    }
    case 'RecyclerView':
    case 'ListView': {
      return `<div class="a-recycler" style="${base}"><div class="rv-item">Item 1</div><div class="rv-item">Item 2</div><div class="rv-item">Item 3</div></div>`;
    }
    case 'CardView':
    case 'MaterialCardView': {
      return `<div class="a-card" style="${base}">${kids}</div>`;
    }
    case 'Toolbar':
    case 'MaterialToolbar': {
      const title = txt(node.attrs['app:title'] ?? node.attrs['android:title']) || 'Toolbar';
      return `<div class="a-toolbar" style="${base}"><span class="menu-icon">☰</span><span class="toolbar-title">${esc(title)}</span></div>`;
    }
    case 'BottomNavigationView':
    case 'NavigationBarView': {
      return `<div class="a-bottom-nav" style="${base}"><span>🏠</span><span>🔍</span><span>⭐</span><span>👤</span></div>`;
    }
    case 'FloatingActionButton':
    case 'ExtendedFloatingActionButton': {
      const t = txt(node.attrs['android:text']);
      return `<div class="a-fab" style="${base}">${t ? esc(t) : '+'}</div>`;
    }
    case 'Switch':
    case 'SwitchMaterial':
    case 'SwitchCompat': {
      return `<label class="a-switch" style="${base}"><input type="checkbox"><span class="slider"></span></label>`;
    }
    case 'CheckBox': {
      const t = txt(node.attrs['android:text']);
      return `<label class="a-check" style="${base}"><input type="checkbox"> ${esc(t)}</label>`;
    }
    case 'RadioButton': {
      const t = txt(node.attrs['android:text']);
      return `<label class="a-check" style="${base}"><input type="radio"> ${esc(t)}</label>`;
    }
    case 'ProgressBar': {
      return `<div class="a-progress" style="${base}"><div class="a-progress-bar"></div></div>`;
    }
    case 'Spinner': {
      return `<select class="a-input" style="${base}"><option>Option 1</option></select>`;
    }
    case 'TabLayout': {
      return `<div class="a-tab-layout" style="${base}"><span class="tab active">Tab 1</span><span class="tab">Tab 2</span><span class="tab">Tab 3</span></div>`;
    }
    case 'ViewPager':
    case 'ViewPager2': {
      return `<div class="a-viewpager" style="${base}">← ViewPager →</div>`;
    }
    case 'include': {
      const layout = node.attrs['layout']?.replace('@layout/', '') ?? '?';
      return `<div class="a-include" style="${base}">📄 include: ${esc(layout)}</div>`;
    }
    case 'View': {
      return `<div style="${base}"></div>`;
    }
    case 'Space': {
      return `<div style="${base}flex:1;"></div>`;
    }
    default: {
      return node.children.length
        ? `<div style="${base}">${kids}</div>`
        : `<div class="a-unknown" style="${base}" title="${shortTag}">${shortTag}</div>`;
    }
  }
}

// ─── HTML Shell ──────────────────────────────────────────────────────────────

function buildHtml(layoutHtml: string, fileName: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview — ${fileName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f0f17;
    --surface: #1c1c2a;
    --border: #2e2e45;
    --accent: #6750A4;
    --accent2: #03DAC5;
    --text-primary: #212121;
    --text-secondary: #666;
    --toolbar-h: 48px;
  }
  body {
    background: var(--bg);
    font-family: 'Roboto', sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    color: #eee;
    padding-bottom: 40px;
  }
  /* ── Top bar ── */
  .top-bar {
    width: 100%;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .top-bar label { font-size: 12px; color: #aaa; }
  .top-bar select, .top-bar button {
    background: #2a2a3e;
    border: 1px solid var(--border);
    color: #eee;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .top-bar button:hover { background: var(--accent); }
  .file-name {
    margin-left: auto;
    font-size: 12px;
    color: var(--accent2);
    font-family: monospace;
  }
  /* ── Phone frame ── */
  .scene {
    margin-top: 32px;
    perspective: 1200px;
  }
  .phone-shell {
    background: linear-gradient(145deg, #2a2a2a, #1a1a1a);
    border-radius: 48px;
    padding: 14px;
    box-shadow:
      0 0 0 1px #444,
      0 0 0 3px #222,
      0 50px 100px rgba(0,0,0,0.8),
      inset 0 1px 0 rgba(255,255,255,0.1);
    position: relative;
  }
  .phone-shell::before {
    content: '';
    position: absolute;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    width: 110px;
    height: 26px;
    background: #0a0a0a;
    border-radius: 0 0 18px 18px;
    z-index: 10;
  }
  .screen-wrap {
    border-radius: 36px;
    overflow: hidden;
    background: #fff;
    position: relative;
  }
  .status-bar {
    background: rgba(0,0,0,0.85);
    color: white;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    font-size: 11px;
    font-weight: 500;
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .status-bar .time { font-weight: 700; }
  .status-bar .icons { display: flex; gap: 4px; align-items: center; font-size: 10px; }
  .layout-area {
    min-height: 300px;
    background: #fafafa;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .nav-bar {
    background: rgba(0,0,0,0.85);
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
    color: white;
    font-size: 18px;
  }
  /* ── Android widgets ── */
  .a-btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    font-size: 14px;
    font-family: 'Roboto', sans-serif;
    font-weight: 500;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .icon-btn { padding: 8px; border-radius: 50%; }
  .a-input {
    border: none;
    border-bottom: 2px solid #6750A4;
    background: transparent;
    padding: 8px 4px;
    font-size: 14px;
    font-family: 'Roboto', sans-serif;
    outline: none;
    width: 100%;
    color: #212121;
  }
  .a-input::placeholder { color: #999; }
  .a-input-layout { border-bottom: 2px solid var(--accent); padding-bottom: 2px; }
  .a-image {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #e0e0e0;
    color: #999;
    font-size: 28px;
    min-height: 60px;
    border-radius: 4px;
  }
  .a-image small { font-size: 10px; margin-top: 4px; color: #aaa; }
  .a-recycler { overflow-y: auto; }
  .rv-item {
    padding: 14px 16px;
    border-bottom: 1px solid #e0e0e0;
    font-size: 14px;
    color: #212121;
  }
  .a-card {
    border-radius: 12px;
    background: white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  .a-toolbar {
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 16px;
    min-height: 56px;
  }
  .menu-icon { font-size: 18px; cursor: pointer; }
  .toolbar-title { font-size: 18px; font-weight: 500; }
  .a-bottom-nav {
    background: white;
    display: flex;
    justify-content: space-around;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid #e0e0e0;
    font-size: 22px;
  }
  .a-fab {
    background: var(--accent);
    color: white;
    border-radius: 50%;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    box-shadow: 0 4px 12px rgba(103,80,164,0.5);
    position: absolute;
    right: 16px;
    bottom: 16px;
  }
  .a-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 48px;
    height: 26px;
  }
  .a-switch input { opacity: 0; width: 0; height: 0; }
  .slider {
    position: absolute;
    inset: 0;
    background: #ccc;
    border-radius: 26px;
    transition: 0.3s;
  }
  .slider::before {
    content: '';
    position: absolute;
    width: 20px;
    height: 20px;
    left: 3px;
    bottom: 3px;
    background: white;
    border-radius: 50%;
    transition: 0.3s;
  }
  .a-switch input:checked + .slider { background: var(--accent); }
  .a-switch input:checked + .slider::before { transform: translateX(22px); }
  .a-check { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #212121; cursor: pointer; }
  .a-check input { accent-color: var(--accent); }
  .a-progress { background: #e0e0e0; border-radius: 4px; height: 6px; overflow: hidden; }
  .a-progress-bar { background: var(--accent); height: 100%; width: 60%; }
  .a-tab-layout {
    display: flex;
    background: var(--accent);
    color: white;
    border-bottom: 2px solid rgba(255,255,255,0.3);
  }
  .tab { padding: 14px 16px; font-size: 14px; font-weight: 500; cursor: pointer; opacity: 0.7; transition: 0.2s; }
  .tab.active { opacity: 1; border-bottom: 2px solid white; }
  .a-viewpager {
    background: #f0f0f0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
    font-size: 14px;
    border: 2px dashed #ccc;
    border-radius: 4px;
    min-height: 80px;
  }
  .a-include {
    background: #fff3e0;
    border: 1px dashed #f57c00;
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 12px;
    color: #e65100;
  }
  .a-unknown {
    background: #fce4ec;
    border: 1px dashed #e91e63;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: #c2185b;
    min-height: 32px;
  }
</style>
</head>
<body>
<div class="top-bar">
  <label>Device</label>
  <select id="deviceSelect" onchange="applyDevice()">
    <option value="412,892">Pixel 7 (412×892)</option>
    <option value="412,1001">Pixel 7 Pro (412×1001)</option>
    <option value="360,800">Small Phone (360×800)</option>
    <option value="600,960">Pixel Tablet (600×960)</option>
  </select>
  <label>Orientation</label>
  <button onclick="toggleOrientation()">↻ Rotate</button>
  <span class="file-name">📄 ${fileName}.xml</span>
</div>

<div class="scene">
  <div class="phone-shell" id="shell">
    <div class="screen-wrap" id="screenWrap">
      <div class="status-bar">
        <span class="time">9:41</span>
        <div class="icons">
          <span>▲▲▲</span>
          <span>WiFi</span>
          <span>🔋</span>
        </div>
      </div>
      <div class="layout-area" id="layoutArea">
        ${layoutHtml}
      </div>
      <div class="nav-bar">
        <span>◀</span><span>●</span><span>■</span>
      </div>
    </div>
  </div>
</div>

<script>
  let portrait = true;
  let w = 412, h = 892;

  function applyDevice() {
    const val = document.getElementById('deviceSelect').value.split(',');
    w = parseInt(val[0]); h = parseInt(val[1]);
    applySize();
  }

  function applySize() {
    const screenWrap = document.getElementById('screenWrap');
    screenWrap.style.width = (portrait ? w : h) + 'px';
    const area = document.getElementById('layoutArea');
    area.style.height = (portrait ? h - 60 : w - 60) + 'px';
  }

  function toggleOrientation() {
    portrait = !portrait;
    const shell = document.getElementById('shell');
    shell.style.transform = portrait ? '' : 'rotate(90deg)';
    applySize();
  }

  applyDevice();
</script>
</body>
</html>`;
}

// ─── Panel Class ─────────────────────────────────────────────────────────────

export class AndroidXmlPreviewPanel {
  static readonly viewType = 'droidStudio.xmlPreview';
  private static _current: AndroidXmlPreviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _currentUri: vscode.Uri | undefined;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, uri?: vscode.Uri): void {
    const col = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.Two;

    if (AndroidXmlPreviewPanel._current) {
      AndroidXmlPreviewPanel._current._panel.reveal(col);
      if (uri) { AndroidXmlPreviewPanel._current._update(uri); }
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      AndroidXmlPreviewPanel.viewType,
      'Layout Preview',
      col,
      { enableScripts: true, localResourceRoots: [extensionUri] }
    );
    AndroidXmlPreviewPanel._current = new AndroidXmlPreviewPanel(panel, uri);
  }

  private constructor(panel: vscode.WebviewPanel, uri?: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    if (uri) { this._update(uri); }

    vscode.window.onDidChangeActiveTextEditor(e => {
      if (e?.document.languageId === 'xml') {
        this._update(e.document.uri);
      }
    }, null, this._disposables);

    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.languageId === 'xml' &&
          this._currentUri?.fsPath === e.document.uri.fsPath) {
        this._render(e.document.getText(), e.document.uri.fsPath);
      }
    }, null, this._disposables);
  }

  private _update(uri: vscode.Uri): void {
    this._currentUri = uri;
    try {
      this._render(fs.readFileSync(uri.fsPath, 'utf-8'), uri.fsPath);
    } catch (err) {
      this._panel.webview.html = `<body style="background:#0f0f17;color:#ff6b6b;padding:20px">Error: ${err}</body>`;
    }
  }

  private _render(xml: string, filePath: string): void {
    const fileName = path.basename(filePath, '.xml');
    this._panel.title = `Preview: ${fileName}`;
    try {
      const root = parseXml(xml);
      const html = root
        ? renderNode(root)
        : `<div style="color:red;padding:16px">Could not parse XML</div>`;
      this._panel.webview.html = buildHtml(html, fileName);
    } catch (err) {
      this._panel.webview.html = buildHtml(
        `<div style="color:red;padding:16px">Error: ${err}</div>`, fileName
      );
    }
  }

  dispose(): void {
    AndroidXmlPreviewPanel._current = undefined;
    this._panel.dispose();
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }
}

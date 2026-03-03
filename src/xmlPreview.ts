import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// â”€â”€â”€ XML Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

// â”€â”€â”€ Simple XML Parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Dimension / Color Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Node Renderer (with index tracking) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _flatNodes: XmlNode[] = [];
let _nodeIdx = 0;

function startRender(): void { _flatNodes = []; _nodeIdx = 0; }
function getFlatNodes(): XmlNode[] { return _flatNodes; }

function renderNode(node: XmlNode): string {
  const idx = _nodeIdx++;
  _flatNodes.push(node);
  const sel = `data-nidx="${idx}" onclick="selectNode(event, ${idx})"`;
  const shortTag = node.tag.split('.').pop() ?? node.tag;
  const w = dim(node.attrs['android:layout_width']);
  const h = dim(node.attrs['android:layout_height']);
  const bg = color(node.attrs['android:background']);
  const vis = node.attrs['android:visibility'] === 'gone' ? 'display:none;' : '';
  const base = `box-sizing:border-box;width:${w};height:${h};${pad(node)}${mar(node)}${bg ? `background:${bg};` : ''}${vis}`;
  // Note: children rendered AFTER registering the parent's index
  const renderKids = () => node.children.map(renderNode).join('');

  switch (shortTag) {
    case 'LinearLayout':
    case 'ScrollView':
    case 'NestedScrollView':
    case 'HorizontalScrollView': {
      const dir = node.attrs['android:orientation'] === 'horizontal' ? 'row' : 'column';
      const g = gravity(node.attrs['android:gravity']);
      return `<div ${sel} style="${base}display:flex;flex-direction:${dir};${g}">${renderKids()}</div>`;
    }
    case 'RelativeLayout':
    case 'ConstraintLayout':
    case 'CoordinatorLayout':
    case 'FrameLayout':
    case 'AppBarLayout': {
      return `<div ${sel} style="${base}position:relative;">${renderKids()}</div>`;
    }
    case 'TextView': {
      const t = txt(node.attrs['android:text'] ?? node.attrs['tools:text']);
      const size = parseFloat(node.attrs['android:textSize'] ?? '14') || 14;
      const c = color(node.attrs['android:textColor']) || 'var(--text-primary)';
      const bold = node.attrs['android:textStyle']?.includes('bold') ? 'font-weight:bold;' : '';
      const g = gravity(node.attrs['android:gravity'], false);
      return `<span ${sel} style="${base}display:block;font-size:${size}px;color:${c};${bold}${g}">${esc(t) || '&nbsp;'}</span>`;
    }
    case 'Button':
    case 'MaterialButton':
    case 'AppCompatButton': {
      const t = txt(node.attrs['android:text']) || 'Button';
      return `<button ${sel} class="a-btn" style="${base}">${esc(t)}</button>`;
    }
    case 'ImageButton': {
      return `<button ${sel} class="a-btn icon-btn" style="${base}">ðŸ–¼</button>`;
    }
    case 'EditText':
    case 'TextInputEditText':
    case 'AutoCompleteTextView': {
      const hint = txt(node.attrs['android:hint'] ?? node.attrs['android:text']);
      return `<input ${sel} class="a-input" placeholder="${esc(hint)}" style="${base}">`;
    }
    case 'TextInputLayout': {
      return `<div ${sel} class="a-input-layout" style="${base}">${renderKids()}</div>`;
    }
    case 'ImageView':
    case 'AppCompatImageView':
    case 'ShapeableImageView': {
      const src = node.attrs['android:src'] ?? node.attrs['app:srcCompat'] ?? '';
      const label = src.replace('@drawable/', '').replace('@mipmap/', '');
      return `<div ${sel} class="a-image" title="${label}">ðŸ–¼<br><small>${label}</small></div>`;
    }
    case 'RecyclerView':
    case 'ListView': {
      return `<div ${sel} class="a-recycler" style="${base}"><div class="rv-item">Item 1</div><div class="rv-item">Item 2</div><div class="rv-item">Item 3</div></div>`;
    }
    case 'CardView':
    case 'MaterialCardView': {
      return `<div ${sel} class="a-card" style="${base}">${renderKids()}</div>`;
    }
    case 'Toolbar':
    case 'MaterialToolbar': {
      const title = txt(node.attrs['app:title'] ?? node.attrs['android:title']) || 'Toolbar';
      return `<div ${sel} class="a-toolbar" style="${base}"><span class="menu-icon">â˜°</span><span class="toolbar-title">${esc(title)}</span></div>`;
    }
    case 'BottomNavigationView':
    case 'NavigationBarView': {
      return `<div ${sel} class="a-bottom-nav" style="${base}"><span>ðŸ </span><span>ðŸ”</span><span>â­</span><span>ðŸ‘¤</span></div>`;
    }
    case 'FloatingActionButton':
    case 'ExtendedFloatingActionButton': {
      const t = txt(node.attrs['android:text']);
      return `<div ${sel} class="a-fab" style="${base}">${t ? esc(t) : '+'}</div>`;
    }
    case 'Switch':
    case 'SwitchMaterial':
    case 'SwitchCompat': {
      return `<label ${sel} class="a-switch" style="${base}"><input type="checkbox"><span class="slider"></span></label>`;
    }
    case 'CheckBox': {
      const t = txt(node.attrs['android:text']);
      return `<label ${sel} class="a-check" style="${base}"><input type="checkbox"> ${esc(t)}</label>`;
    }
    case 'RadioButton': {
      const t = txt(node.attrs['android:text']);
      return `<label ${sel} class="a-check" style="${base}"><input type="radio"> ${esc(t)}</label>`;
    }
    case 'ProgressBar': {
      return `<div ${sel} class="a-progress" style="${base}"><div class="a-progress-bar"></div></div>`;
    }
    case 'Spinner': {
      return `<select ${sel} class="a-input" style="${base}"><option>Option 1</option></select>`;
    }
    case 'TabLayout': {
      return `<div ${sel} class="a-tab-layout" style="${base}"><span class="tab active">Tab 1</span><span class="tab">Tab 2</span><span class="tab">Tab 3</span></div>`;
    }
    case 'ViewPager':
    case 'ViewPager2': {
      return `<div ${sel} class="a-viewpager" style="${base}">â† ViewPager â†’</div>`;
    }
    case 'include': {
      const layout = node.attrs['layout']?.replace('@layout/', '') ?? '?';
      return `<div ${sel} class="a-include" style="${base}">ðŸ“„ include: ${esc(layout)}</div>`;
    }
    case 'View': {
      return `<div ${sel} style="${base}"></div>`;
    }
    case 'Space': {
      return `<div ${sel} style="${base}flex:1;"></div>`;
    }
    default: {
      return node.children.length
        ? `<div ${sel} style="${base}">${renderKids()}</div>`
        : `<div ${sel} class="a-unknown" style="${base}" title="${shortTag}">${shortTag}</div>`;
    }
  }
}

// â”€â”€â”€ HTML Shell (3-panel IDE) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildHtml(layoutHtml: string, fileName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Layout Preview â€” ${fileName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --bg:#0d0d14;--surface:#161622;--surface2:#1e1e2e;
  --border:#2a2a3f;--accent:#6750A4;--accent2:#03DAC5;
  --text:#e0e0e0;--text-dim:#888;
  --text-primary:#212121;
}
html,body{height:100%;overflow:hidden;}
body{background:var(--bg);font-family:'Roboto',sans-serif;color:var(--text);display:flex;flex-direction:column;}
/* â”€â”€ Top bar â”€â”€ */
.topbar{
  background:var(--surface);border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:10px;padding:6px 12px;flex-shrink:0;
  font-size:12px;
}
.topbar select,.topbar button{
  background:#252538;border:1px solid var(--border);color:var(--text);
  border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer;
}
.topbar button:hover{background:var(--accent);}
.topbar .fname{margin-left:auto;color:var(--accent2);font-family:monospace;font-size:11px;}
/* â”€â”€ 3 panels â”€â”€ */
.workspace{display:flex;flex:1;overflow:hidden;}
/* LEFT â€” palette */
.palette{
  width:190px;flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);
  overflow-y:auto;display:flex;flex-direction:column;
}
.palette-header{
  padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;
  letter-spacing:1px;color:var(--text-dim);border-bottom:1px solid var(--border);
  background:var(--surface2);position:sticky;top:0;
}
.palette-cat{padding:4px 10px;font-size:10px;color:var(--accent2);font-weight:600;margin-top:6px;}
.palette-item{
  display:flex;align-items:center;gap:8px;padding:6px 12px;
  font-size:12px;cursor:pointer;border-radius:4px;margin:1px 6px;
  transition:background .15s;
}
.palette-item:hover{background:var(--surface2);}
.palette-item .icon{width:20px;text-align:center;font-size:14px;}
/* CENTER â€” canvas */
.canvas{
  flex:1;overflow:auto;display:flex;flex-direction:column;
  align-items:center;padding:24px 16px;background:var(--bg);
  gap:12px;
}
/* PHONE */
.phone-shell{
  background:linear-gradient(145deg,#2a2a2a,#1a1a1a);
  border-radius:44px;padding:12px;
  box-shadow:0 0 0 1px #444,0 0 0 3px #222,0 40px 80px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.07);
  position:relative;
}
.phone-shell::before{
  content:'';position:absolute;top:16px;left:50%;transform:translateX(-50%);
  width:100px;height:24px;background:#0a0a0a;border-radius:0 0 14px 14px;z-index:10;
}
.screen-wrap{border-radius:32px;overflow:hidden;background:#fff;position:relative;}
.status-bar{
  background:rgba(0,0,0,.88);color:#fff;height:26px;
  display:flex;align-items:center;justify-content:space-between;
  padding:0 18px;font-size:10px;font-weight:500;
}
.layout-area{background:#fafafa;overflow-y:auto;overflow-x:hidden;}
.nav-bar{
  background:rgba(0,0,0,.88);height:30px;display:flex;
  align-items:center;justify-content:center;gap:28px;color:#fff;font-size:16px;
}
/* Selection highlight */
[data-nidx]{cursor:pointer;outline:2px solid transparent;outline-offset:-2px;transition:outline .1s;}
[data-nidx]:hover{outline:2px dashed rgba(103,80,164,.6)!important;}
[data-nidx].selected{outline:2px solid #6750A4!important;}
/* RIGHT â€” properties */
.props{
  width:220px;flex-shrink:0;background:var(--surface);border-left:1px solid var(--border);
  overflow-y:auto;display:flex;flex-direction:column;
}
.props-header{
  padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;
  letter-spacing:1px;color:var(--text-dim);border-bottom:1px solid var(--border);
  background:var(--surface2);position:sticky;top:0;
}
.props-tag{
  padding:8px 10px;font-size:11px;color:var(--accent2);font-family:monospace;
  border-bottom:1px solid var(--border);background:var(--surface2);
}
.prop-row{
  display:flex;flex-direction:column;gap:2px;
  padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);
}
.prop-name{font-size:10px;color:var(--text-dim);}
.prop-val{
  background:#252538;border:1px solid var(--border);color:var(--text);
  border-radius:4px;padding:3px 6px;font-size:11px;font-family:monospace;
  width:100%;outline:none;
}
.prop-val:focus{border-color:var(--accent);}
.apply-btn{
  margin:10px;background:var(--accent);color:#fff;border:none;
  border-radius:6px;padding:7px;font-size:12px;cursor:pointer;font-weight:500;
}
.apply-btn:hover{opacity:.85;}
.props-empty{padding:20px 10px;text-align:center;color:var(--text-dim);font-size:12px;}
/* Android widgets */
.a-btn{background:#6750A4;color:#fff;border:none;border-radius:4px;padding:8px 16px;font-size:14px;font-weight:500;cursor:pointer;text-transform:uppercase;letter-spacing:.5px;}
.icon-btn{padding:8px;border-radius:50%;}
.a-input{border:none;border-bottom:2px solid #6750A4;background:transparent;padding:8px 4px;font-size:14px;outline:none;width:100%;color:#212121;}
.a-input::placeholder{color:#999;}
.a-input-layout{border-bottom:2px solid #6750A4;padding-bottom:2px;}
.a-image{display:flex;flex-direction:column;align-items:center;justify-content:center;background:#e0e0e0;color:#999;font-size:28px;min-height:60px;border-radius:4px;}
.a-image small{font-size:10px;margin-top:4px;color:#aaa;}
.a-recycler{overflow-y:auto;}
.rv-item{padding:14px 16px;border-bottom:1px solid #e0e0e0;font-size:14px;color:#212121;}
.a-card{border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.15);}
.a-toolbar{background:#6750A4;color:#fff;display:flex;align-items:center;gap:16px;padding:0 16px;min-height:56px;}
.menu-icon{font-size:18px;}.toolbar-title{font-size:18px;font-weight:500;}
.a-bottom-nav{background:#fff;display:flex;justify-content:space-around;align-items:center;padding:8px 0;border-top:1px solid #e0e0e0;font-size:22px;}
.a-fab{background:#6750A4;color:#fff;border-radius:50%;width:56px;height:56px;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 4px 12px rgba(103,80,164,.5);position:absolute;right:16px;bottom:16px;}
.a-switch{position:relative;display:inline-flex;align-items:center;width:48px;height:26px;}
.a-switch input{opacity:0;width:0;height:0;}
.slider{position:absolute;inset:0;background:#ccc;border-radius:26px;transition:.3s;}
.slider::before{content:'';position:absolute;width:20px;height:20px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.3s;}
.a-switch input:checked+.slider{background:#6750A4;}
.a-switch input:checked+.slider::before{transform:translateX(22px);}
.a-check{display:flex;align-items:center;gap:8px;font-size:14px;color:#212121;cursor:pointer;}
.a-check input{accent-color:#6750A4;}
.a-progress{background:#e0e0e0;border-radius:4px;height:6px;overflow:hidden;}
.a-progress-bar{background:#6750A4;height:100%;width:60%;}
.a-tab-layout{display:flex;background:#6750A4;color:#fff;}
.tab{padding:14px 16px;font-size:14px;font-weight:500;cursor:pointer;opacity:.7;}
.tab.active{opacity:1;border-bottom:2px solid #fff;}
.a-viewpager{background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;border:2px dashed #ccc;border-radius:4px;min-height:80px;}
.a-include{background:#fff3e0;border:1px dashed #f57c00;border-radius:4px;padding:8px 12px;font-size:12px;color:#e65100;}
.a-unknown{background:#fce4ec;border:1px dashed #e91e63;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#c2185b;min-height:32px;}
</style>
</head>
<body>
<!-- Top bar -->
<div class="topbar">
  <label>Device</label>
  <select id="devSel" onchange="applyDevice()">
    <option value="412,892">Pixel 7 (412Ã—892)</option>
    <option value="412,1001">Pixel 7 Pro</option>
    <option value="360,800">Small Phone</option>
    <option value="600,960">Pixel Tablet</option>
  </select>
  <button onclick="toggleOri()">â†» Rotate</button>
  <span class="fname">ðŸ“„ ${fileName}.xml</span>
</div>
<!-- Workspace -->
<div class="workspace">
  <!-- LEFT: Widget Palette -->
  <div class="palette">
    <div class="palette-header">Widget Palette</div>
    <div id="palette-list"></div>
  </div>
  <!-- CENTER: Phone Canvas -->
  <div class="canvas">
    <div class="phone-shell" id="shell">
      <div class="screen-wrap" id="sw">
        <div class="status-bar">
          <span style="font-weight:700">9:41</span>
          <div style="display:flex;gap:4px;font-size:10px">â–²â–²â–² WiFi ðŸ”‹</div>
        </div>
        <div class="layout-area" id="la">${layoutHtml}</div>
        <div class="nav-bar">â—€ â— â– </div>
      </div>
    </div>
  </div>
  <!-- RIGHT: Properties -->
  <div class="props">
    <div class="props-header">Properties</div>
    <div id="props-content"><div class="props-empty">Click a widget<br>to see its properties</div></div>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
let portrait=true,pw=412,ph=892,selIdx=-1;

// â”€â”€ Device sizing â”€â”€
function applyDevice(){
  const v=document.getElementById('devSel').value.split(',');
  pw=+v[0];ph=+v[1];applySize();
}
function applySize(){
  document.getElementById('sw').style.width=(portrait?pw:ph)+'px';
  document.getElementById('la').style.height=(portrait?ph-56:pw-56)+'px';
}
function toggleOri(){
  portrait=!portrait;
  document.getElementById('shell').style.transform=portrait?'':'rotate(90deg)';
  applySize();
}

// â”€â”€ Widget Palette â”€â”€
const WIDGETS=[
  {cat:'Layouts',items:[
    {n:'LinearLayout (V)',i:'â¬›',s:'<LinearLayout\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"\n    android:orientation="vertical">\n\n</LinearLayout>'},
    {n:'LinearLayout (H)',i:'â¬œ',s:'<LinearLayout\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"\n    android:orientation="horizontal">\n\n</LinearLayout>'},
    {n:'ConstraintLayout',i:'ðŸ“',s:'<androidx.constraintlayout.widget.ConstraintLayout\n    android:layout_width="match_parent"\n    android:layout_height="match_parent">\n\n</androidx.constraintlayout.widget.ConstraintLayout>'},
    {n:'FrameLayout',i:'ðŸ”²',s:'<FrameLayout\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content">\n\n</FrameLayout>'},
    {n:'ScrollView',i:'ðŸ“œ',s:'<ScrollView\n    android:layout_width="match_parent"\n    android:layout_height="match_parent">\n\n</ScrollView>'},
    {n:'CardView',i:'ðŸƒ',s:'<com.google.android.material.card.MaterialCardView\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"\n    android:layout_margin="8dp"\n    app:cardCornerRadius="12dp">\n\n</com.google.android.material.card.MaterialCardView>'},
  ]},
  {cat:'Text &amp; Input',items:[
    {n:'TextView',i:'T',s:'<TextView\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:text="Hello World"\n    android:textSize="16sp"/>'},
    {n:'EditText',i:'âœï¸',s:'<EditText\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"\n    android:hint="Enter text"/>'},
    {n:'TextInputLayout',i:'ðŸ“',s:'<com.google.android.material.textfield.TextInputLayout\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content">\n    <com.google.android.material.textfield.TextInputEditText\n        android:layout_width="match_parent"\n        android:layout_height="wrap_content"\n        android:hint="Label"/>\n</com.google.android.material.textfield.TextInputLayout>'},
  ]},
  {cat:'Buttons',items:[
    {n:'Button',i:'ðŸ”˜',s:'<Button\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:text="Button"/>'},
    {n:'MaterialButton',i:'ðŸ”µ',s:'<com.google.android.material.button.MaterialButton\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:text="Click Me"/>'},
    {n:'FAB',i:'âž•',s:'<com.google.android.material.floatingactionbutton.FloatingActionButton\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:src="@android:drawable/ic_input_add"/>'},
    {n:'ImageButton',i:'ðŸ–¼',s:'<ImageButton\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:src="@android:drawable/ic_menu_add"/>'},
  ]},
  {cat:'Display',items:[
    {n:'ImageView',i:'ðŸ–¼',s:'<ImageView\n    android:layout_width="match_parent"\n    android:layout_height="200dp"\n    android:scaleType="centerCrop"\n    android:src="@drawable/placeholder"/>'},
    {n:'RecyclerView',i:'ðŸ“‹',s:'<androidx.recyclerview.widget.RecyclerView\n    android:id="@+id/recyclerView"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent"/>'},
    {n:'ProgressBar',i:'â³',s:'<ProgressBar\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"/>'},
  ]},
  {cat:'Navigation',items:[
    {n:'Toolbar',i:'ðŸ“Œ',s:'<com.google.android.material.appbar.MaterialToolbar\n    android:id="@+id/toolbar"\n    android:layout_width="match_parent"\n    android:layout_height="?attr/actionBarSize"\n    app:title="My App"/>'},
    {n:'Bottom Navigation',i:'ðŸ§­',s:'<com.google.android.material.bottomnavigation.BottomNavigationView\n    android:id="@+id/bottomNav"\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"\n    app:menu="@menu/bottom_nav_menu"/>'},
    {n:'TabLayout',i:'ðŸ“‘',s:'<com.google.android.material.tabs.TabLayout\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"/>'},
  ]},
  {cat:'Forms',items:[
    {n:'CheckBox',i:'â˜‘ï¸',s:'<CheckBox\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:text="Option"/>'},
    {n:'Switch',i:'ðŸ”›',s:'<com.google.android.material.switchmaterial.SwitchMaterial\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:text="Toggle"/>'},
    {n:'Spinner',i:'â–¼',s:'<Spinner\n    android:layout_width="match_parent"\n    android:layout_height="wrap_content"/>'},
  ]},
];

function buildPalette(){
  const list=document.getElementById('palette-list');
  WIDGETS.forEach(cat=>{
    const catEl=document.createElement('div');
    catEl.className='palette-cat';
    catEl.textContent=cat.cat;
    list.appendChild(catEl);
    cat.items.forEach(w=>{
      const el=document.createElement('div');
      el.className='palette-item';
      el.innerHTML='<span class="icon">'+w.i+'</span><span>'+w.n+'</span>';
      el.title='Click to insert into XML';
      el.onclick=()=>insertWidget(w.s);
      list.appendChild(el);
    });
  });
}

function insertWidget(snippet){
  vscode.postMessage({type:'insert',snippet});
}

// â”€â”€ Node selection â”€â”€
function selectNode(e,idx){
  e.stopPropagation();
  document.querySelectorAll('[data-nidx]').forEach(el=>el.classList.remove('selected'));
  const el=document.querySelector('[data-nidx="'+idx+'"]');
  if(el)el.classList.add('selected');
  selIdx=idx;
  vscode.postMessage({type:'select',idx});
}

window.addEventListener('message',e=>{
  const msg=e.data;
  if(msg.type==='attrs')showProps(msg.tag,msg.attrs);
});

function showProps(tag,attrs){
  const c=document.getElementById('props-content');
  const keys=Object.keys(attrs);
  if(!keys.length){c.innerHTML='<div class="props-empty">No attributes</div>';return;}
  const tagDiv='<div class="props-tag">'+tag+'</div>';
  const rows=keys.map(k=>{
    const v=attrs[k].replace(/"/g,'&quot;');
    return '<div class="prop-row"><div class="prop-name">'+k+'</div><input class="prop-val" data-attr="'+k+'" value="'+v+'"></div>';
  }).join('');
  c.innerHTML=tagDiv+rows+'<button class="apply-btn" onclick="applyProps()">âœ” Apply Changes</button>';
}

function applyProps(){
  if(selIdx<0)return;
  const changes={};
  document.querySelectorAll('.prop-val').forEach(inp=>{
    changes[inp.dataset.attr]=inp.value;
  });
  vscode.postMessage({type:'updateAttr',idx:selIdx,changes});
}

buildPalette();
applyDevice();
</script>
</body>
</html>`;
}

// â”€â”€â”€ Panel Class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class AndroidXmlPreviewPanel {
  static readonly viewType = 'droidStudio.xmlPreview';
  private static _current: AndroidXmlPreviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private _currentUri: vscode.Uri | undefined;
  private _flatNodes: XmlNode[] = [];
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, uri?: vscode.Uri): void {
    const col = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside : vscode.ViewColumn.Two;
    if (AndroidXmlPreviewPanel._current) {
      AndroidXmlPreviewPanel._current._panel.reveal(col);
      if (uri) { AndroidXmlPreviewPanel._current._update(uri); }
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      AndroidXmlPreviewPanel.viewType, 'Layout Preview', col,
      { enableScripts: true, localResourceRoots: [extensionUri] }
    );
    AndroidXmlPreviewPanel._current = new AndroidXmlPreviewPanel(panel, uri);
  }

  private constructor(panel: vscode.WebviewPanel, uri?: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from WebView
    this._panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'insert') {
        await this._insertSnippet(msg.snippet as string);
      } else if (msg.type === 'select') {
        const node = this._flatNodes[msg.idx as number];
        if (node) {
          this._panel.webview.postMessage({
            type: 'attrs', tag: node.tag, attrs: node.attrs,
          });
        }
      } else if (msg.type === 'updateAttr') {
        await this._updateAttributes(msg.idx as number, msg.changes as Record<string, string>);
      }
    }, null, this._disposables);

    if (uri) { this._update(uri); }

    vscode.window.onDidChangeActiveTextEditor(e => {
      if (e?.document.languageId === 'xml') { this._update(e.document.uri); }
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
      this._panel.webview.html = `<body style="background:#0d0d14;color:#f88;padding:20px">Error: ${err}</body>`;
    }
  }

  private _render(xml: string, filePath: string): void {
    const fileName = path.basename(filePath, '.xml');
    this._panel.title = `Preview: ${fileName}`;
    try {
      startRender();
      const root = parseXml(xml);
      const html = root ? renderNode(root) : `<div style="color:red;padding:16px">Could not parse XML</div>`;
      this._flatNodes = getFlatNodes();
      this._panel.webview.html = buildHtml(html, fileName);
    } catch (err) {
      this._panel.webview.html = buildHtml(`<div style="color:red;padding:16px">Error: ${err}</div>`, fileName);
    }
  }

  private async _insertSnippet(snippet: string): Promise<void> {
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.fsPath === this._currentUri?.fsPath
    ) ?? vscode.window.activeTextEditor;
    if (!editor) {
      // Open the file and insert
      if (this._currentUri) {
        const doc = await vscode.workspace.openTextDocument(this._currentUri);
        const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        await ed.insertSnippet(new vscode.SnippetString('\n' + snippet + '\n'));
      }
      return;
    }
    await editor.insertSnippet(new vscode.SnippetString('\n' + snippet + '\n'));
  }

  private async _updateAttributes(
    idx: number, changes: Record<string, string>
  ): Promise<void> {
    const node = this._flatNodes[idx];
    if (!node || !this._currentUri) { return; }

    const doc = await vscode.workspace.openTextDocument(this._currentUri);
    const text = doc.getText();

    // Build regex to find tag opening: <TagName ... up to first > or />
    const shortTag = node.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Find the Nth occurrence matching the node's own attribute signature
    // Strategy: find all opening tags of this type, pick the one whose attrs match best
    const tagRegex = new RegExp(`<${shortTag}(?:\\.|[^>])*?>`, 'gs');
    let match: RegExpExecArray | null;
    let bestMatch: { start: number; end: number } | undefined;

    // Use known attrs to identify the specific tag
    const knownAttrKey = Object.keys(node.attrs)[0];
    const knownAttrVal = knownAttrKey ? node.attrs[knownAttrKey] : undefined;

    while ((match = tagRegex.exec(text)) !== null) {
      const tagText = match[0];
      if (!knownAttrKey || (knownAttrVal && tagText.includes(knownAttrVal))) {
        bestMatch = { start: match.index, end: match.index + tagText.length };
        break;
      }
    }

    if (!bestMatch) {
      vscode.window.showWarningMessage('Droid Studio: Could not locate widget in XML to update.');
      return;
    }

    // Rebuild the tag text with updated attributes
    let tagText = text.slice(bestMatch.start, bestMatch.end);
    for (const [attrName, newVal] of Object.entries(changes)) {
      const attrRegex = new RegExp(`(${attrName.replace(/[:]/g, '\\$&')}=)["']([^"']*)["']`);
      if (attrRegex.test(tagText)) {
        tagText = tagText.replace(attrRegex, `$1"${newVal}"`);
      } else {
        // Attribute doesn't exist yet â€” insert before the closing > or />
        tagText = tagText.replace(/(\s*\/?>\s*)$/, `\n    ${attrName}="${newVal}"$1`);
      }
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this._currentUri,
      new vscode.Range(doc.positionAt(bestMatch.start), doc.positionAt(bestMatch.end)),
      tagText
    );
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage('âœ… Attributes updated!');
  }

  dispose(): void {
    AndroidXmlPreviewPanel._current = undefined;
    this._panel.dispose();
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }
}


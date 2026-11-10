/**
 * electron/main.js — 桌面 APP 外壳
 *
 * 直接 loadFile 会因为 file:// 的 CORS 限制而无法加载 ES Module，
 * 因此这里把构建产物（dist/starstrike.html，单文件）作为普通页面加载。
 */
const { app, BrowserWindow, Menu, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const DIST_HTML = path.join(ROOT, 'dist', 'starstrike.html');

let win = null;

function resolveEntry() {
  if (fs.existsSync(DIST_HTML)) return DIST_HTML;
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  return DIST_HTML;
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: Math.min(1440, Math.round(width * 0.92)),
    height: Math.min(900, Math.round(height * 0.92)),
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#05030c',
    title: '星锋突击 STARSTRIKE',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  const entry = resolveEntry();
  if (!fs.existsSync(entry)) {
    // 未构建时给出可读提示
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="background:#05030c;color:#dff2ff;font-family:sans-serif;padding:48px;line-height:2">
             <h2>未找到构建产物</h2>
             <p>请先在项目根目录执行：</p>
             <pre style="color:#5fe8ff">npm install</pre>
             <pre style="color:#5fe8ff">npm run build</pre>
             <p>然后重新启动本应用。</p>
           </body>`
        )
    );
  } else {
    win.loadFile(entry);
  }

  // F11 全屏 / F12 调试
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
    if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 关闭 GPU 黑名单限制，尽量启用硬件加速
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');

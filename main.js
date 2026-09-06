const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog, safeStorage, globalShortcut, Notification, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');
const { autoUpdater } = require('electron-updater');

// Suppress Chromium internal cache lock noise & disable unnecessary disk cache
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('log-level', '3');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
app.commandLine.appendSwitch('renderer-process-limit', '2');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess');

// Single-instance lock to prevent concurrent instances locking the same cache files
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

let win  = null;
let tray = null;
let db   = null;

// Window & Avatar layout constants
const W = 440;
const H = 680;
const AV_OFF_X = 346;
const AV_OFF_Y = 586;

let isDraggingWin = false;
let currentAvatarPos = null; // { x, y }
let lastSetX = null;
let lastSetY = null;

function saveCurrentAvatarPos() {
  if (!win || win.isDestroyed() || !db) return;
  const bounds = win.getBounds();
  currentAvatarPos = { x: bounds.x + AV_OFF_X, y: bounds.y + AV_OFF_Y };
  try {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['avatar_pos', JSON.stringify(currentAvatarPos)]);
    saveDB();
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────
// Programmatic PNG generator (no external deps needed for tray icon)
// ─────────────────────────────────────────────────────────────────────
function createCirclePNG(size, r, g, b) {
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const radius = size / 2 - 1.5;

  const rawRows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const off = 1 + x * 4;
      const alpha = Math.max(0, Math.min(255, Math.round((radius - dist + 1) * 255)));
      row[off]     = r;
      row[off + 1] = g;
      row[off + 2] = b;
      row[off + 3] = dist <= radius ? 255 : alpha > 0 ? alpha : 0;
    }
    rawRows.push(row);
  }

  const raw        = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw);

  // CRC32
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c;
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  }

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// ─────────────────────────────────────────────────────────────────────
// SQLite via sql.js (pure JS — no native compilation needed)
// ─────────────────────────────────────────────────────────────────────
async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  const dbPath = path.join(app.getPath('userData'), 'thinkora-bot.db');
  const oldDbPath = path.join(app.getPath('userData'), 'companion.db');
  if (!fs.existsSync(dbPath) && fs.existsSync(oldDbPath)) {
    try {
      fs.copyFileSync(oldDbPath, dbPath);
    } catch (_) {}
  }

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    title   TEXT    NOT NULL DEFAULT 'New Chat',
    ts      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL DEFAULT 1,
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    ts         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reminders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT    NOT NULL,
    due_ts     INTEGER NOT NULL,
    created_ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    status     TEXT    NOT NULL DEFAULT 'pending'
  )`);

  // Migrate existing data if needed
  try { db.run('ALTER TABLE messages ADD COLUMN session_id INTEGER DEFAULT 1'); } catch(e) {}
  db.run(`INSERT OR IGNORE INTO sessions (id, title) VALUES (1, 'Initial Chat')`);

  saveDB();
}

function saveDB() {
  const dbPath = path.join(app.getPath('userData'), 'thinkora-bot.db');
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

// ─────────────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────────────
function setupIPC() {
  // ── DB ──────────────────────────────────────────────────────────────
  ipcMain.handle('db:get', (_, key) => {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt.bind([key]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    let val = row ? row.value : null;
    if (val && key === 'api_key' && safeStorage.isEncryptionAvailable()) {
      if (!val.startsWith('AIzaSy')) {
        try {
          const decrypted = safeStorage.decryptString(Buffer.from(val, 'hex'));
          if (decrypted) val = decrypted;
        } catch(e) {}
      }
    }
    return val;
  });

  ipcMain.handle('db:set', (_, key, value) => {
    let saveVal = value ? String(value).trim() : '';
    if (key === 'api_key' && saveVal && safeStorage.isEncryptionAvailable()) {
      try {
        saveVal = safeStorage.encryptString(saveVal).toString('hex');
      } catch(e) {}
    }
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, saveVal]);
    saveDB();
    return true;
  });

  ipcMain.handle('db:save-message', (_, sessionId, role, content) => {
    db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, role, content]);
    saveDB();
  });

  ipcMain.handle('db:get-messages', (_, sessionId) => {
    const stmt = db.prepare('SELECT role, content, ts FROM messages WHERE session_id = ? ORDER BY id ASC');
    stmt.bind([sessionId]);
    const msgs = [];
    while (stmt.step()) {
      msgs.push(stmt.getAsObject());
    }
    stmt.free();
    return msgs;
  });

  ipcMain.handle('db:get-previous-context', (_, currentSessionId, limit = 30) => {
    let sql = 'SELECT session_id, role, content, ts FROM messages';
    let params = [];
    if (currentSessionId) {
      sql += ' WHERE session_id != ?';
      params.push(currentSessionId);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit || 30);
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const msgs = [];
    while (stmt.step()) {
      msgs.push(stmt.getAsObject());
    }
    stmt.free();
    return msgs.reverse();
  });

  ipcMain.handle('db:clear', (_, sessionId) => {
    if (sessionId) {
      db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
    } else {
      db.run('DELETE FROM messages');
    }
    saveDB();
  });

  ipcMain.handle('db:get-sessions', () => {
    const res = db.exec('SELECT id, title, ts FROM sessions ORDER BY ts DESC');
    if (!res.length) return [];
    const [{ columns, values }] = res;
    return values.map(row => {
      const obj = {};
      columns.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  });

  ipcMain.handle('db:create-session', () => {
    db.run('INSERT INTO sessions (title) VALUES (?)', ['New Chat']);
    const res = db.exec('SELECT last_insert_rowid() AS id');
    saveDB();
    return res[0].values[0][0];
  });

  ipcMain.handle('db:delete-session', (_, sessionId) => {
    db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
    saveDB();
  });

  ipcMain.handle('db:update-session-title', (_, sessionId, title) => {
    db.run('UPDATE sessions SET title = ? WHERE id = ?', [title, sessionId]);
    saveDB();
  });

  ipcMain.handle('db:reset', () => {
    db.run('DELETE FROM settings');
    db.run('DELETE FROM messages');
    db.run('DELETE FROM sessions');
    db.run('DELETE FROM reminders');
    saveDB();
    return true;
  });

  // ── Reminders IPC ────────────────────────────────────────────────────
  ipcMain.handle('db:create-reminder', (_, text, due_ts) => {
    db.run('INSERT INTO reminders (text, due_ts, status) VALUES (?, ?, ?)', [text, due_ts, 'pending']);
    const res = db.exec('SELECT last_insert_rowid() AS id');
    saveDB();
    return res[0].values[0][0];
  });

  ipcMain.handle('db:get-reminders', (_, statusFilter) => {
    let sql = 'SELECT id, text, due_ts, created_ts, status FROM reminders';
    let params = [];
    if (statusFilter) {
      sql += ' WHERE status = ?';
      params.push(statusFilter);
    }
    sql += ' ORDER BY due_ts ASC';
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const items = [];
    while (stmt.step()) {
      items.push(stmt.getAsObject());
    }
    stmt.free();
    return items;
  });

  ipcMain.handle('db:update-reminder-status', (_, id, status) => {
    db.run('UPDATE reminders SET status = ? WHERE id = ?', [status, id]);
    saveDB();
  });

  ipcMain.handle('db:delete-reminder', (_, id) => {
    db.run('DELETE FROM reminders WHERE id = ?', [id]);
    saveDB();
  });

  ipcMain.handle('window:pick-image', async () => {
    const parentWin = settingsWin || win;
    const { canceled, filePaths } = await dialog.showOpenDialog(parentWin, {
      title: 'Select Avatar Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif', 'jpeg', 'webp'] }],
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) return null;
    try {
      const data = fs.readFileSync(filePaths[0]);
      let ext = path.extname(filePaths[0]).toLowerCase().substring(1) || 'png';
      if (ext === 'jpg') ext = 'jpeg';
      return `data:image/${ext};base64,${data.toString('base64')}`;
    } catch(e) {
      return null;
    }
  });

  // ── Open Settings Window ───────────────────────────────────────────
  ipcMain.on('window:open-settings', (_, tab) => {
    openSettingsWindow(tab);
  });

  ipcMain.on('settings:notify-updated', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:changed');
    }
  });

  // ── Window ──────────────────────────────────────────────────────────
  ipcMain.on('window:ignore-mouse', (_, ignore) => {
    if (!win) return;
    if (ignore) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  });

  // ── Absolute Window Dragging (DPI-Safe with fixed dimensions) ───────
  ipcMain.on('drag:start', () => {
    if (!win) return;
    isDraggingWin = true;
    lastSetX = null;
    lastSetY = null;
  });

  ipcMain.on('drag:to', (_, targetX, targetY) => {
    if (!win || !isDraggingWin) return;
    if (typeof targetX !== 'number' || typeof targetY !== 'number') return;
    const x = Math.round(targetX);
    const y = Math.round(targetY);
    if (x === lastSetX && y === lastSetY) return;
    lastSetX = x;
    lastSetY = y;
    win.setBounds({ x, y, width: W, height: H });
  });

  ipcMain.on('drag:move', (_, dx, dy) => {
    if (!win || !isDraggingWin) return;
    if (typeof dx !== 'number' || typeof dy !== 'number') return;
    const bounds = win.getBounds();
    const x = Math.round(bounds.x + dx);
    const y = Math.round(bounds.y + dy);
    if (x === lastSetX && y === lastSetY) return;
    lastSetX = x;
    lastSetY = y;
    win.setBounds({ x, y, width: W, height: H });
  });

  ipcMain.on('drag:end', () => {
    if (!win) return;
    isDraggingWin = false;
    lastSetX = null;
    lastSetY = null;
    saveCurrentAvatarPos();
  });

  // ── When chat opens: ensure entire chat window is on-screen ──────────
  ipcMain.on('chat:opened', () => {
    if (!win) return;
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: Math.round(bounds.x + AV_OFF_X), y: Math.round(bounds.y + AV_OFF_Y) });
    const wa = display.workArea;

    let newX = bounds.x;
    let newY = bounds.y;

    if (newY < wa.y) newY = wa.y;
    if (newY + H > wa.y + wa.height) newY = wa.y + wa.height - H;
    if (newX < wa.x) newX = wa.x;
    if (newX + W > wa.x + wa.width) newX = wa.x + wa.width - W;

    if (newX !== bounds.x || newY !== bounds.y) {
      win.setBounds({ x: newX, y: newY, width: W, height: H });
    }
  });

  // ── Context Menu ────────────────────────────────────────────────────
  ipcMain.on('window:context-menu', (_, isMinimized) => {
    if (!win) return;
    const menu = Menu.buildFromTemplate([
      isMinimized
        ? { label: 'Maximize Bot', click: () => { if (win) win.webContents.send('bot:restore'); } }
        : { label: 'Minimize Bot', click: () => { if (win) win.webContents.send('bot:minimize'); } },
      { label: 'Hide Thinkora Bot', click: () => { win.hide(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.quit(); } }
    ]);
    menu.popup({ window: win });
  });

  // ── Notify (Windows toast) ───────────────────────────────────────────
  ipcMain.on('window:notify', (_, title, body) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => {
      if (win) { win.show(); win.webContents.send('bot:restore'); }
    });
    n.show();
  });

  // ── Open external URL in browser ────────────────────────────────────
  ipcMain.on('open:external', (_, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Create the overlay window
// ─────────────────────────────────────────────────────────────────────
function createWindow(savedAvPos) {
  const primary = screen.getPrimaryDisplay();
  const workArea = primary.workArea;

  let avX = workArea.x + workArea.width - 70 - 30;
  let avY = workArea.y + workArea.height - 70 - 30;

  if (savedAvPos && typeof savedAvPos.x === 'number' && typeof savedAvPos.y === 'number') {
    avX = savedAvPos.x;
    avY = savedAvPos.y;
    const display = screen.getDisplayNearestPoint({ x: Math.round(avX), y: Math.round(avY) });
    const wa = display.workArea;
    avX = Math.max(wa.x, Math.min(avX, wa.x + wa.width - 70));
    avY = Math.max(wa.y, Math.min(avY, wa.y + wa.height - 70));
  }

  currentAvatarPos = { x: avX, y: avY };
  const startX = Math.round(avX - AV_OFF_X);
  const startY = Math.round(avY - AV_OFF_Y);

  win = new BrowserWindow({
    width:       W,
    height:      H,
    x:           startX,
    y:           startY,
    transparent: true,
    frame:       false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    focusable:   true,
    hasShadow:   false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      spellcheck:       false,
      backgroundThrottling: true,
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open target="_blank" links in default external browser (e.g. Chrome)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    win.show();
    // Start click-through on transparent areas
    win.setIgnoreMouseEvents(true, { forward: true });
  });

  // Keep always on top even when other windows are focused
  win.setAlwaysOnTop(true, 'screen-saver');

  // Cancel dragging safety if window loses focus
  win.on('blur', () => {
    if (isDraggingWin) {
      isDraggingWin = false;
      saveCurrentAvatarPos();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Dedicated Settings Window
// ─────────────────────────────────────────────────────────────────────
let settingsWin = null;

function openSettingsWindow(tab = 'general') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    settingsWin.webContents.send('settings:switch-tab', tab);
    return;
  }

  const customIconPath = path.join(__dirname, 'build', 'icon.ico');

  settingsWin = new BrowserWindow({
    width: 680,
    height: 660,
    minWidth: 640,
    minHeight: 620,
    title: 'Thinkora Bot Settings',
    icon: fs.existsSync(customIconPath) ? customIconPath : undefined,
    backgroundColor: '#f8fafc',
    autoHideMenuBar: true,
    resizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
    }
  });

  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'), { query: { tab } });
  
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.webContents.send('settings:switch-tab', tab);
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

// ─────────────────────────────────────────────────────────────────────
// System Tray
// ─────────────────────────────────────────────────────────────────────
function createTray() {
  const customIconPath = path.join(__dirname, 'build', 'icon.ico');
  let icon;
  if (fs.existsSync(customIconPath)) {
    icon = nativeImage.createFromPath(customIconPath);
  } else {
    const iconBuf = createCirclePNG(32, 45, 182, 163); // teal fallback
    icon = nativeImage.createFromBuffer(iconBuf);
  }
  tray = new Tray(icon);
  tray.setToolTip('Thinkora Bot');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Bot',
      click: () => {
        if (win.isVisible()) {
          win.hide();
        } else {
          win.show();
          win.setAlwaysOnTop(true, 'screen-saver');
        }
      }
    },
    {
      label: 'Settings ⚙️',
      click: () => { openSettingsWindow('general'); }
    },
    {
      label: 'Reminders ⏰',
      click: () => { openSettingsWindow('reminders'); }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.quit(); }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    win.isVisible() ? win.hide() : win.show();
  });
}

// ─────────────────────────────────────────────────────────────────────
// Auto Updater (electron-updater via GitHub Releases)
// ─────────────────────────────────────────────────────────────────────

// Helper: send update events to the settings window (if open)
function sendToSettings(channel, payload) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send(channel, payload);
  }
}

function setupAutoUpdater() {
  // ── IPC: renderer-driven update actions ─────────────────────────
  ipcMain.handle('updater:check', async () => {
    if (!app.isPackaged) {
      sendToSettings('updater:status', { state: 'up-to-date', version: app.getVersion() });
      return;
    }
    try { await autoUpdater.checkForUpdates(); } catch(e) {
      sendToSettings('updater:status', { state: 'error', message: e.message });
    }
  });

  ipcMain.handle('updater:download', async () => {
    if (!app.isPackaged) return;
    try { await autoUpdater.downloadUpdate(); } catch(e) {
      sendToSettings('updater:status', { state: 'error', message: e.message });
    }
  });

  ipcMain.handle('updater:install', () => {
    if (!app.isPackaged) return;
    autoUpdater.quitAndInstall();
  });

  // Don't run auto-updater listeners in unpackaged dev mode
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false; // User decides
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendToSettings('updater:status', { state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendToSettings('updater:status', { state: 'available', version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendToSettings('updater:status', { state: 'up-to-date', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    if (win) win.setProgressBar(progress.percent / 100);
    sendToSettings('updater:status', {
      state: 'downloading',
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (win) win.setProgressBar(-1);
    sendToSettings('updater:status', { state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err.message);
    sendToSettings('updater:status', { state: 'error', message: err.message });
  });

  // Check silently on startup after short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

// ─────────────────────────────────────────────────────────────────────
// Background Reminder Scheduler
// ─────────────────────────────────────────────────────────────────────
let reminderInterval = null;

function startReminderChecker() {
  if (reminderInterval) clearInterval(reminderInterval);
  
  reminderInterval = setInterval(() => {
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    try {
      const stmt = db.prepare('SELECT id, text, due_ts FROM reminders WHERE status = ? AND due_ts <= ?');
      stmt.bind(['pending', now]);
      const dueList = [];
      while (stmt.step()) {
        dueList.push(stmt.getAsObject());
      }
      stmt.free();

      for (const r of dueList) {
        db.run('UPDATE reminders SET status = ? WHERE id = ?', ['fired', r.id]);
        saveDB();

        // Fire Windows Toast Notification
        if (Notification.isSupported()) {
          const n = new Notification({
            title: '⏰ Thinkora Bot Reminder',
            body: r.text,
            silent: false
          });
          n.on('click', () => {
            if (win) {
              win.show();
              win.webContents.send('bot:restore');
            }
          });
          n.show();
        }

        // Notify renderer to play chime, speak, and show in chat
        if (win) {
          win.webContents.send('reminder:fired', r);
        }
      }
    } catch(err) {}
  }, 10000);
}

// ─────────────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await initDB();
  setupIPC();
  startReminderChecker();
  
  // Load saved avatar position
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  stmt.bind(['avatar_pos']);
  let row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  let savedAvPos = null;
  if (row) {
    try { savedAvPos = JSON.parse(row.value); } catch(e) {}
  } else {
    // Fallback: check legacy win_pos
    const stmt2 = db.prepare('SELECT value FROM settings WHERE key = ?');
    stmt2.bind(['win_pos']);
    row = stmt2.step() ? stmt2.getAsObject() : null;
    stmt2.free();
    if (row) {
      try {
        const wp = JSON.parse(row.value);
        if (wp && wp.length === 2) savedAvPos = { x: wp[0] + 346, y: wp[1] + 586 };
      } catch(e) {}
    }
  }
  
  createWindow(savedAvPos);
  createTray();
  setupAutoUpdater();
  
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('shortcut:open-chat');
    }
  });
});

// Prevent default quit when all windows close (keep tray alive)
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // SQLite DB operations (handled in main process)
  db: {
    get:         (key)          => ipcRenderer.invoke('db:get', key),
    set:         (key, value)   => ipcRenderer.invoke('db:set', key, value),
    saveMessage: (sessionId, role, content) => ipcRenderer.invoke('db:save-message', sessionId, role, content),
    getMessages: (sessionId)    => ipcRenderer.invoke('db:get-messages', sessionId),
    getPreviousContext: (currentSessionId, limit) => ipcRenderer.invoke('db:get-previous-context', currentSessionId, limit),
    clear:       (sessionId)    => ipcRenderer.invoke('db:clear', sessionId),
    getSessions: ()             => ipcRenderer.invoke('db:get-sessions'),
    createSession: ()           => ipcRenderer.invoke('db:create-session'),
    deleteSession: (sessionId)  => ipcRenderer.invoke('db:delete-session', sessionId),
    updateSessionTitle: (sessionId, title) => ipcRenderer.invoke('db:update-session-title', sessionId, title),
    resetAll: () => ipcRenderer.invoke('db:reset'),
    createReminder: (text, due_ts) => ipcRenderer.invoke('db:create-reminder', text, due_ts),
    getReminders: (statusFilter) => ipcRenderer.invoke('db:get-reminders', statusFilter),
    updateReminderStatus: (id, status) => ipcRenderer.invoke('db:update-reminder-status', id, status),
    deleteReminder: (id) => ipcRenderer.invoke('db:delete-reminder', id),
  },

  // Click-through: pass true = transparent area (forward to OS), false = interactive
  setIgnoreMouse: (ignore) => ipcRenderer.send('window:ignore-mouse', ignore),

  // Drag / Window movement
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove:  (dx, dy) => ipcRenderer.send('drag:move', dx, dy),
  dragTo:    (targetX, targetY) => ipcRenderer.send('drag:to', targetX, targetY),
  dragEnd:   () => ipcRenderer.send('drag:end'),

  // Shortcut listener
  onShortcutOpenChat: (callback) => ipcRenderer.on('shortcut:open-chat', callback),

  // Context menu
  showContextMenu: (isMinimized) => ipcRenderer.send('window:context-menu', isMinimized),

  // Image Picker
  pickImage: () => ipcRenderer.invoke('window:pick-image'),

  // Notifications
  notify: (title, body) => ipcRenderer.send('window:notify', title, body),

  // Minimize / restore bot
  onMinimizeBot: (cb) => ipcRenderer.on('bot:minimize', cb),
  onRestoreBot:  (cb) => ipcRenderer.on('bot:restore', cb),

  // Chat opened notification to ensure window is on-screen
  notifyChatOpened: () => ipcRenderer.send('chat:opened'),

  // Open external URL in browser (e.g. Chrome)
  openExternal: (url) => ipcRenderer.send('open:external', url),

  // Reminders event listener
  onReminderFired: (callback) => ipcRenderer.on('reminder:fired', (_, r) => callback(r)),

  // Standalone Settings Window
  openSettings: (tab) => ipcRenderer.send('window:open-settings', tab),
  notifySettingsUpdated: () => ipcRenderer.send('settings:notify-updated'),
  onSettingsChanged: (callback) => ipcRenderer.on('settings:changed', callback),
  onSettingsSwitchTab: (callback) => ipcRenderer.on('settings:switch-tab', (_, tab) => callback(tab)),

  // Auto-updater
  updater: {
    check:   () => ipcRenderer.invoke('updater:check'),
    download:() => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus:(callback) => ipcRenderer.on('updater:status', (_, payload) => callback(payload)),
  },
});

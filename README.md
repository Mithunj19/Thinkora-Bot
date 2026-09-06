# Thinkora Bot

A beautifully designed, floating desktop AI companion built with **Electron** and **Google Gemini API**. Thinkora Bot lives unobtrusively on your Windows desktop as a transparent, interactive floating avatar that you can move, customize, chat with, and summon at any time for conversation, emotional support, voice interactions, task reminders, and general queries.

---

## 🌟 Key Features

### 🎙️ Speech & Voice Interaction
* **Voice-to-Text Dictation (Token Optimized)**: Click the microphone icon to speak naturally. Your voice is transcribed into plain text before being sent to the API, slashing token usage by ~99% and avoiding heavy audio quota limits.
* **Auto-Stop Mic on Send**: Instantly halts microphone recording and releases audio hardware tracks the moment you send a message, preventing background recording or trailing speech transcription.
* **Zero-Token Local Voice Output (TTS)**: Thinkora Bot speaks its responses aloud using Windows' native local speech engine (`SpeechSynthesis`), consuming **0 API tokens**.
* **Replay Any Past Message**: Click the 🔊 speaker button beside any past or current bot message bubble to have it read aloud instantly.
* **Distinct Voice Personalities & Installed System Voices**:
  * 🌸 **Warm & Soft**: Gentle, soothing female voice tone.
  * ⚡ **Upbeat & Cheerful**: High-energy, optimistic tone.
  * 🌙 **Calm & Deep**: Low, relaxing male tone.
  * 🤖 **Cyber Robot**: Mechanical, futuristic tone.
  * 🎤 **System Voices**: Automatically detects and lists all installed Windows TTS voices with an in-app ▶️ **Test Voice** preview button.

### 🧠 Cross-Session Memory & Auto-Learning
* **Continuous Multi-Session Memory**: Thinkora Bot remembers past conversations across sessions and never forgets context when you start a new chat.
* **Autonomous Fact Extraction**: Automatically learns and saves facts about you (e.g. nicknames, preferences, hobbies, work, pets) to persistent SQLite storage (`user_memory`).
* **Editable Long-Term Memory**: View, edit, add, or clear permanent memories anytime in **Settings ⚙️ &rarr; Memory**.

### ⚡ Ultra-Low Idle Resource Consumption
* **Optimized Memory Footprint**: Tuned V8 heap limits (`--max-old-space-size=128`) and disabled Chromium spellchecker memory overhead to keep idle RAM usage minimal.
* **GPU Hardware Accelerated Compositing**: Floating avatar layers use hardware transforms (`will-change: transform`, `translateZ(0)`) to avoid continuous CPU rasterization on transparent layers.
* **Micro-Throttled Event Loops**: Overlay hit-testing and background polling are micro-throttled to maintain 0% CPU consumption when idle.

### 🧠 Intelligent Multi-Model Fallback
* **Seamless Model Failover**: Automatically connects to the fastest and highest-capacity models:
  * Primary: `gemini-3.5-flash-lite` (1,500 free requests/day)
  * Secondary: `gemini-3.5-flash`
  * Fallbacks: `gemini-3.7-flash`, `gemini-3.1-flash-lite`, `gemini-3.6-flash`
* **Rate-Limit Resilience**: If a model hits a temporary quota or rate limit, the app instantly rolls over to the next candidate model in real time without interrupting your conversation.

### ⏰ AI Reminders & Desktop Alarms
* **Natural Language Scheduling**: Ask the bot naturally: *"set reminder 5:00 PM to drink water"*, *"remind me in 15 minutes to stretch"*, or *"set timer for 10 mins"*.
* **Persistent SQLite Storage**: Reminders are saved to local SQLite (`reminders` table) and survive app or system restarts.
* **Multi-Channel Alarm Alert**:
  * 🔔 **Windows Toast Notification**: Real-time native desktop alert with clickable callback.
  * 🎵 **Synthesized Audio Chime**: Melodic arpeggio chime generated locally via Web Audio API (0 dependencies).
  * 🗣️ **Spoken Voice Output**: Automatically speaks the reminder aloud if voice mode is enabled.
  * 💬 **In-Chat Log & Avatar Bounce**: Displays the reminder bubble in your active session and shakes the avatar.
* **Dedicated Reminders UI**: Manage active countdowns and view past reminders directly from the header ⏰ button or Settings tab.

### ⚙️ Dedicated Standalone Settings Window
Settings opens in an independent, spacious desktop window so your floating companion remains clean, minimal, and uncluttered:
* 👤 **Profile Tab**: Customize Bot Name, User Name, and Gemini API Key with an unmask toggle button (👁️).
* 🎨 **Style Tab**: Select from curated color palettes (Classic Teal, Neon Pink, Soft Purple, Sunset Orange, Cyber Amber, Aurora Green, Deep Indigo, Cyber Glow), animation dynamics (Orbit, Pulse, Float, Static), avatar presets, or upload a custom image.
* 🔊 **Voice Tab**: Toggle Response Modes (Text Only vs Text + Voice), select personality tone styles or system voices, and test audio.
* ⏰ **Reminders Tab**: View upcoming reminders with remaining countdowns, manually add reminders with a time picker, or delete existing ones.
* 🧠 **Memory Tab**: Configure persistent long-term memories for Thinkora Bot, clear chat history, or trigger a **🔄 Factory Reset**.

### 🪟 Desktop Ergonomics & Aesthetics
* **Click-Through Transparency**: Fully transparent, borderless overlay window that forwards mouse clicks to background apps when not hovering over the avatar.
* **Smooth 1:1 Avatar Dragging**: Move Thinkora Bot anywhere across your screen with mouse-capture protection to prevent accidental threshold drops.
* **Smart Screen Edge Repositioning**: When the avatar is placed near the top or edges of your screen, opening the chat panel automatically adjusts the window bounds to ensure the panel is never clipped.
* **Real-Time Markdown Streaming**: Streams AI responses using Server-Sent Events (SSE) with live Markdown parsing, code snippets, and auto-scrolling.
* **Multi-Session Chat History**: Easily start new conversations or browse past sessions with automatic conversation title summarization.

---

## 🛠️ Technology Stack

* **Core Framework**: [Electron](https://www.electronjs.org/) (Node.js backend + Chromium frontend)
* **Frontend UI**: Vanilla HTML5, CSS3, and modern JavaScript (Zero external CSS frameworks, maximum 60fps performance and low memory footprint).
* **Database**: `sql.js` (WebAssembly-based SQLite embedded locally in `%APPDATA%/thinkora-bot/thinkora-bot.db`).
* **Security**: Electron `safeStorage` DPAPI encryption for local API key storage.
* **AI Provider**: Google Gemini API (`gemini-3.5-flash-lite`, `gemini-3.5-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`).

---

## 📁 Project Structure

```text
thinkora-bot/
├── main.js                # Electron main process (Window management, IPC handlers, SQLite init, safeStorage DPAPI)
├── preload.js             # Context Bridge (Secure IPC APIs between main and renderer processes)
├── package.json           # Dependencies, scripts, and electron-builder NSIS packaging config
├── build/                 # App icons and packaging assets
└── renderer/
    ├── index.html         # Floating bot companion UI (Avatar, chat panel, voice dictation & speech engine)
    └── settings.html      # Dedicated standalone Settings & Reminders management window
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js** (v18 or higher recommended)
* A valid **Gemini API Key** (obtainable for free from [Google AI Studio](https://aistudio.google.com/app/apikey))

### Installation
1. Clone or navigate to the repository folder:
   ```bash
   cd thinkora-bot
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally
To launch Thinkora Bot in development mode:
```bash
npm start
```
*Note: If running for the first time, a setup wizard will guide you through entering your bot's name and Gemini API key.*

---

## 📦 Packaging for Distribution

You can bundle and build a standalone Windows installer (`.exe`) using `electron-builder`:

```bash
npm run build
```

This compiles a production-ready NSIS installer in the `dist/` directory (e.g., `dist/Thinkora Bot Setup 1.0.2.exe`).

---

## 🔐 Privacy & Security

* **100% Local Storage**: All chat history, long-term memories, and preferences are stored exclusively on your device in your local SQLite database (`thinkora-bot.db`).
* **Encrypted API Keys**: API keys are encrypted at rest using Windows DPAPI via Electron's `safeStorage`.
* **Zero Telemetry**: No personal data or diagnostics are sent to any third-party servers. Requests are communicated directly between your local machine and Google's Gemini API endpoints.

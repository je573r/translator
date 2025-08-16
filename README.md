# Translator Overlay (Tauri v2)

Always-on-top, transparent floating overlay for real-time subtitles/translation. Includes:

- Draggable overlay handle with click-through elsewhere
- No visible window frame/shadow
- Sample changing text to mimic subtitles
- System audio capture to WAV (Windows, via WASAPI/CPAL), with basic loopback device heuristics


## Getting Started (Windows Only)

### 1. Prerequisites

- **Windows 10/11** (required; overlay and audio capture only work on Windows)
- **Rust toolchain** (stable): [Install Rust](https://rustup.rs)
- **Node.js** (LTS recommended): [Download Node.js](https://nodejs.org/)
- **Tauri CLI**: Install globally with:
  ```cmd
  cargo install tauri-cli
  ```
- **Build tools**: You may need the [Windows Build Tools](https://tauri.app/v1/guides/getting-started/prerequisites/#windows) (Visual Studio Build Tools, C++ workload)

### 2. Install Dependencies

Open a terminal in the project folder and run:

```cmd
npm install
```


### 3. Set Environment Variables

You must set your Azure Speech credentials in your shell **before launching**:

**Command Prompt:**
```cmd
set AZURE_SPEECH_KEY=YOUR_KEY
set AZURE_SPEECH_REGION=eastus
```

**PowerShell:**
```powershell
$env:AZURE_SPEECH_KEY="YOUR_KEY"
$env:AZURE_SPEECH_REGION="eastus"
```

Replace `YOUR_KEY` with your Azure Speech API key. These variables are required for the app to access Azure Speech services.

### 4. Run the App (Dev Mode)

```cmd
cargo tauri dev
```

This will open the launcher window. Use the launcher UI to start the floating overlay window. You can select source/target languages, and change the UI language from the top-right dropdown.

---

#### Notes
- **System audio capture:** On most Windows systems, the app can capture audio without any special setup. If you encounter issues, you may try enabling a loopback input (like "Stereo Mix") or installing [VB-Audio Virtual Cable](https://vb-audio.com/Cable/), but this is not required for all users.
- **Device selection:** If you see a silent WAV or no audio, check your Windows sound settings or try a different input device in the app.
- **Overlay window:** The floating overlay is always-on-top, draggable, and click-through except for the handle. You can move it anywhere on your screen.
- **Launcher UI:** The launcher lets you pick source/target languages, start/stop translation, and change the UI language. All controls are designed to be unobtrusive and easy to use.
- **Dependencies:** Make sure you have Rust, Node.js, and Tauri CLI installed as described above. If you run into build errors, check that you have the required Windows build tools (see Tauri docs for details).

### 5. Build a Release Bundle

```cmd
cargo tauri build
```

This will create a distributable Windows executable in the `src-tauri/target/release` directory.

## Project Structure

- `src-tauri/` — Tauri Rust backend and app config
  - `src/` — frontend files (`index.html`, `main.js`, `style.css`)
  - `tauri.conf.json` — overlay window settings
  - `capabilities/` — Tauri permissions

## License

MIT — see `LICENSE`.



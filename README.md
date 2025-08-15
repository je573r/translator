# Translator Overlay (Tauri v2)

Always-on-top, transparent floating overlay for real-time subtitles/translation. Includes:

- Draggable overlay handle with click-through elsewhere
- No visible window frame/shadow
- Sample changing text to mimic subtitles
- System audio capture to WAV (Windows, via WASAPI/CPAL), with basic loopback device heuristics

## Prerequisites

- Rust toolchain (stable). Install via `https://rustup.rs`.
- Windows 10/11 (WASAPI-based capture). For true system output capture, enable a loopback input (e.g., "Stereo Mix") or install VB-Audio Virtual Cable.

## Run (dev)

```bash
cargo tauri dev
```

The overlay opens. In DevTools Console:

```js
// Optional: list available input devices
await listInputDevices();

// Start capture to a WAV path (adjust path as you like)
await startSystemCapture('C:\\Users\\<you>\\Downloads\\system_capture.wav');

// Stop capture
await stopSystemCapture();
```

Notes:
- If you see a silent WAV with headphones connected, Windows likely switched/disabled your loopback input. Use `listInputDevices()` and pick a loopback device (e.g., "Stereo Mix", "CABLE Output"). The app currently prefers these names by heuristic; next step is a UI selector.

## Build (bundles)

```bash
cargo tauri build
```

## Project Structure

- `src-tauri/` — Tauri Rust backend and app config
  - `src/` — frontend files (`index.html`, `main.js`, `style.css`)
  - `tauri.conf.json` — overlay window settings
  - `capabilities/` — Tauri permissions

## License

MIT — see `LICENSE`.



async function waitForTauri() {
  if (window.__TAURI__?.core?.invoke) return window.__TAURI__;
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.__TAURI__?.core?.invoke) {
        clearInterval(timer);
        resolve(window.__TAURI__);
      } else if (Date.now() - start > 5000) {
        clearInterval(timer);
        resolve(window.__TAURI__ || {});
      }
    }, 50);
  });
}

async function testOverlay() {
  const T = await waitForTauri();
  // Use global __TAURI__ to avoid bundler; works in Tauri v2
  const win = T?.webviewWindow?.getCurrent?.();
  if (win) {
    await win.setAlwaysOnTop(true);
    // Enable click-through except on the drag handle
    await win.setIgnoreCursorEvents(true);
    // Hide OS window shadow/border
    if (win.setShadow) {
      await win.setShadow(false);
    }
    // Disable any native visual effects that might create outlines
    if (win.setEffects) {
      await win.setEffects({ effects: [] });
    }
  }

  const subtitles = [
    "This is a sample subtitle line.",
    "It changes every couple of seconds.",
    "Use this to mimic live captions.",
    "Replace with your real transcript later.",
    "Testing overlay rendering...",
  ];
  let idx = 0;
  setInterval(() => {
    const el = document.getElementById("overlay");
    if (!el) return;
    el.textContent = subtitles[idx % subtitles.length];
    idx += 1;
  }, 1500);

  // Drag handle logic: temporarily disable click-through while dragging
  const handle = document.getElementById("drag-handle");
  if (handle && win) {
    let dragging = false;
    const beginDrag = async (e) => {
      try {
        dragging = true;
        await win.setIgnoreCursorEvents(false);
        await win.startDragging();
      } finally {
        // after a short delay re-enable click-through
        setTimeout(async () => {
          if (dragging) {
            await win.setIgnoreCursorEvents(true);
            dragging = false;
          }
        }, 50);
      }
    };
    handle.addEventListener("mousedown", beginDrag);
    handle.addEventListener("touchstart", beginDrag, { passive: true });
  }

  // Expose simple test controls in devtools console
  // Tauri v2: invoke is under __TAURI__.core
  const invoke = T?.core?.invoke || T?.tauri?.invoke || T?.invoke;
  window.startSystemCapture = async (path) => {
    if (!invoke) {
      console.error("Tauri invoke API not available");
      return undefined;
    }
    const out = await invoke("start_system_capture", { outputWavPath: path });
    console.log("Capture started, writing to:", out);
    return out;
  };
  window.stopSystemCapture = async () => {
    if (!invoke) {
      console.error("Tauri invoke API not available");
      return undefined;
    }
    const out = await invoke("stop_system_capture");
    console.log("Capture stopped");
    return out;
  };

  // Helper to list available input devices (so you can confirm which loopback to use)
  window.listInputDevices = async () => {
    if (!invoke) return [];
    const names = await invoke("list_input_devices");
    console.log("Input devices:", names);
    return names;
  };
}

testOverlay();

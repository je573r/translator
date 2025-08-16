async function main() {
  const autoDetectEl = document.getElementById("autoDetect");
  const fromEl = document.getElementById("fromLang");
  const toEl = document.getElementById("toLang");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const statusEl = document.getElementById("status");

  // Initialize dropdown enabled/disabled based on checkbox state
  fromEl.disabled = autoDetectEl.checked;

  autoDetectEl.addEventListener("change", () => {
    fromEl.disabled = autoDetectEl.checked;
  });

  let stopAzureFn = null;

  const setStatus = (s) => (statusEl.textContent = s);

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true; stopBtn.disabled = false; setStatus("Starting...");
    const region = "eastus"; // token uses env already
    const targetLang = toEl.value || "en";
    const opts = { region, targetLang };
    if (autoDetectEl.checked) {
      opts.autoDetect = true;
      opts.candidates = ["en-US", "hi-IN"]; 
    } else {
      opts.fromLang = fromEl.value || "en-US";
    }
    try {
      const T = window.__TAURI__;
      await T.core.invoke("start_system_capture", { outputWavPath: null });
      // Create (or get) the overlay; setting visible: true ensures it actually shows
      let overlay;
      try {
        overlay = new T.webviewWindow.WebviewWindow("overlay", { url: "index.html", visible: true });
      } catch (_) {
        try {
          if (T.webviewWindow?.WebviewWindow?.getByLabel) {
            overlay = T.webviewWindow.WebviewWindow.getByLabel("overlay");
          }
        } catch {}
      }
      if (overlay && overlay.show) { try { await overlay.show(); } catch {} }
      // Broadcast event to ensure overlay listener receives it regardless of window handle
      // Give the overlay a brief moment to load listeners, then emit
      await new Promise((r) => setTimeout(r, 200));
      if (T.event?.emit) { await T.event.emit("start-stream", opts); }
      setStatus("Translating...");
    } catch (e) {
      console.error(e); setStatus("Error starting");
      startBtn.disabled = false; stopBtn.disabled = true;
    }
  });

  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true; setStatus("Stopping...");
    try {
      const T = window.__TAURI__;
      if (T.event?.emit) { await T.event.emit("stop-stream"); }
      await T.core.invoke("stop_system_capture");
      let overlay = null;
      try {
        if (T.webviewWindow?.WebviewWindow?.getByLabel) {
          overlay = T.webviewWindow.WebviewWindow.getByLabel("overlay");
        }
      } catch {}
      if (overlay && overlay.hide) { try { await overlay.hide(); } catch {} }
      setStatus("Idle");
    } catch (e) { console.error(e); setStatus("Error stopping"); }
    startBtn.disabled = false; stopBtn.disabled = true;
  });
}

main();



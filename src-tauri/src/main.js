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

  // Demo text loop (disabled automatically once Azure streaming starts)
  const subtitles = [
    "This is a sample subtitle line.",
    "It changes every couple of seconds.",
    "Use this to mimic live captions.",
    "Replace with your real transcript later.",
    "Testing overlay rendering...",
  ];
  let idx = 0;
  window.__SUB_TIMER = setInterval(() => {
    if (window.__AZURE_ACTIVE) return; // don't overwrite when streaming
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

  // Azure streaming bootstrap (called when you want to start translation)
  window.startAzureStream = async (opts) => {
    window.__AZURE_ACTIVE = true;
    if (window.__SUB_TIMER) { clearInterval(window.__SUB_TIMER); window.__SUB_TIMER = null; }
    // opts: { region, targetLang, autoDetect: true|false, fromLang?: string }
    if (!invoke) { console.error("invoke not available"); return; }
    const token = await invoke("get_azure_token"); // backend reads env vars
    // Dynamically load SDK if not present
    if (!window.SpeechSDK) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://aka.ms/csspeech/jsbrowserpackageraw";
        s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      });
    }
    const SpeechSDK = window.SpeechSDK;
    const region = (opts && opts.region) || (await invoke("get_azure_region").catch(()=>null)) || "eastus";
    const cfg = SpeechSDK.SpeechTranslationConfig.fromAuthorizationToken(token, region);
    cfg.addTargetLanguage((opts && opts.targetLang) || "en");
    // Source language requirement: either specify speechRecognitionLanguage or provide AutoDetect config
    let autoCfg = null;
    if (opts && opts.autoDetect) {
      const candidates = (opts && opts.candidates && opts.candidates.length)
        ? opts.candidates
        : ["en-US", "hi-IN"]; // sensible defaults; adjust later in UI
      autoCfg = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(candidates);
    } else {
      cfg.speechRecognitionLanguage = (opts && opts.fromLang) || "en-US"; // default to a valid locale
    }
    const pushStream = SpeechSDK.AudioInputStream.createPushStream(
      SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
    );
    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
    const recognizer = autoCfg
      ? new SpeechSDK.TranslationRecognizer(cfg, audioConfig, autoCfg)
      : new SpeechSDK.TranslationRecognizer(cfg, audioConfig);

    // Pipe PCM frames from backend
    // Fail-safe: drop lingering listeners before starting
    if (window.__PCM_UNLISTEN) { try { window.__PCM_UNLISTEN(); } catch {} window.__PCM_UNLISTEN = null; }

    const unlisten = await T.event?.listen?.("pcm-frame", (e) => {
      const b64 = e?.payload?.b64; if (!b64) return;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      pushStream.write(bytes);
    });
    window.__PCM_UNLISTEN = unlisten;

    let lastText = "";
    recognizer.recognizing = (_s, e) => {
      const text = e.result?.translations?.get?.(cfg.targetLanguages[0]) || e.result?.text || "";
      if (text && text !== lastText) {
        const el = document.getElementById("overlay"); if (el) el.textContent = text;
        lastText = text;
      }
    };
    recognizer.recognized = (_s, e) => {
      const text = e.result?.translations?.get?.(cfg.targetLanguages[0]) || e.result?.text || "";
      if (text) {
        const el = document.getElementById("overlay"); if (el) el.textContent = text;
        lastText = text;
      }
    };
    recognizer.canceled = (_s, e) => { console.warn("Azure canceled", e.errorDetails); };
    recognizer.sessionStopped = () => { console.log("Azure session stopped"); };

    recognizer.startContinuousRecognitionAsync();

    // Return a stopper
    return async () => {
      pushStream.close();
      await new Promise((res)=> recognizer.stopContinuousRecognitionAsync(()=>res(), ()=>res()));
      if (window.__PCM_UNLISTEN) { try { window.__PCM_UNLISTEN(); } catch {} window.__PCM_UNLISTEN = null; }
      window.__AZURE_ACTIVE = false;
    };
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

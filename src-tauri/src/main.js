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

  // Demo text loop for idle state; writes to LL2 only if Azure is inactive
  const subtitles = [
    "This is a sample subtitle line.",
    "It changes every couple of seconds.",
    "Use this to mimic live captions.",
    "Replace with your real transcript later.",
    "Testing overlay rendering...",
  ];
  let idx = 0;
  window.__SUB_TIMER = setInterval(() => {
    if (window.__AZURE_ACTIVE) return;
    const ll2 = document.getElementById("ov-ll2");
    if (!ll2) return;
    ll2.textContent = subtitles[idx % subtitles.length];
    idx += 1;
  }, 1500);

  // Drag handle logic: temporarily disable click-through while dragging
  const handle = document.getElementById("drag-handle");
  const overlay = document.getElementById('overlay');
  if (handle) {
    // Ensure dot elements exist
    if (!handle.querySelector('.grip-dots')) {
      const dots = document.createElement('div');
      dots.className = 'grip-dots';
      for (let i = 0; i < 6; i++) {
        const d = document.createElement('div'); d.className = 'dot'; dots.appendChild(d);
      }
      handle.appendChild(dots);
    }
    // Align the handle to the overlay's left edge
    const alignHandle = () => {
  if (!overlay || !handle) return;
  const rect = overlay.getBoundingClientRect();
  const handleWidth = 32; // keep in sync with CSS
  const handleHeight = 44; // keep in sync with CSS
  const right = 24; // fixed distance from window right edge
  const desiredTop = rect.top + (rect.height / 2) - (handleHeight / 2);
  const top = Math.max(4, Math.min(window.innerHeight - handleHeight - 4, Math.round(desiredTop)));
  handle.style.left = '';
  handle.style.right = `${right}px`;
  handle.style.top = `${top}px`;
    };
    // Run on next frame in case layout not settled
    requestAnimationFrame(alignHandle);
    window.addEventListener('resize', alignHandle);
    try { const ro = new ResizeObserver(() => alignHandle()); if (overlay) ro.observe(overlay); } catch {}

    // Dragging behavior (only when win available)
    if (win) {
      let dragging = false;
      const beginDrag = async () => {
        try {
          dragging = true;
          try { await win.setIgnoreCursorEvents(false); } catch {}
          try { await win.startDragging(); } catch {}
        } finally {
          setTimeout(async () => {
            if (dragging) {
              try { await win.setIgnoreCursorEvents(true); } catch {}
              dragging = false;
            }
          }, 50);
        }
      };
      handle.addEventListener("mousedown", beginDrag);
      handle.addEventListener("touchstart", beginDrag, { passive: true });
    }
  }

  // Allow hold-Shift to temporarily disable click-through for dragging/interaction
  if (win) {
    let shiftDown = false;
    document.addEventListener("keydown", async (e) => {
      if (e.key === "Shift" && !shiftDown) {
        shiftDown = true;
  try { await win.setIgnoreCursorEvents(false); } catch {}
      }
    });
    document.addEventListener("keyup", async (e) => {
      if (e.key === "Shift") {
        shiftDown = false;
  try { await win.setIgnoreCursorEvents(true); } catch {}
      }
    });
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

  // Global event hooks so launcher can control overlay
  if (T?.event?.listen) {
    await T.event.listen("start-stream", async (e) => {
      try {
        if (window.__AZURE_ACTIVE) return;
        const opts = e?.payload || {};
        window.__STOP_AZURE = await window.startAzureStream(opts);
      } catch (err) { console.error(err); }
    });
    await T.event.listen("stop-stream", async () => {
      try { if (window.__STOP_AZURE) { await window.__STOP_AZURE(); window.__STOP_AZURE = null; } } catch {}
    });
  }
  // Azure streaming bootstrap (called when you want to start translation)
  // Variable-height history: pack finalized segments into #ov-history (newest at bottom)
  const setRow = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text || ""; };
  const pushHistory = (finalText) => {
    if (!finalText) return;
    // HL1 <- HL2; HL2 <- LL1; LL1 <- "" (LL2 remains live)
    const hl1 = document.getElementById("ov-hl1");
    const hl2 = document.getElementById("ov-hl2");
    const ll1 = document.getElementById("ov-ll1");
    if (!(hl1 && hl2 && ll1)) return;
    hl1.textContent = hl2.textContent;
    hl2.textContent = finalText;
    ll1.textContent = "";
  };

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

    // Quality/stability tweaks
    cfg.setProperty(SpeechSDK.PropertyId.SpeechServiceResponse_PostProcessingOption, "TrueText");
    cfg.setProperty(SpeechSDK.PropertyId.SpeechServiceResponse_StablePartialResultThreshold, "2");
    cfg.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "5000");
    cfg.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "1200");
    cfg.setProperty(SpeechSDK.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps, "true");
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

    const MAX_CH = 56; // approx for single line width
    const PROMOTE_CH = 44; // chunk size target
    let lastText = "";
    let lastUpdateTs = 0;
    // Staged texts
    let ll1Text = "";
    let ll2Text = "";
    let hl1Text = "";
    let hl2Text = "";
    let committed = ""; // prefix already flushed into rows
    const redrawLL2 = (text) => {
      const now = performance.now();
      if (now - lastUpdateTs < 30) return; // ~33 fps
      setRow("ov-ll2", text);
      lastUpdateTs = now;
    };

    // Split long text into fixed-size chunks and push history
    const splitAndPush = (text) => {
      let t = text.trim();
      const seps = /[\s,.!?;:，。！？；：]/g;
      while (t.length > MAX_CH) {
        // find last separator within MAX_CH
        let splitIdx = -1;
        seps.lastIndex = 0;
        let m;
        while ((m = seps.exec(t)) && m.index < MAX_CH) splitIdx = m.index + 1;
        if (splitIdx <= 0) splitIdx = MAX_CH;
        const seg = t.slice(0, splitIdx).trim();
        if (seg) pushHistory(seg);
        t = t.slice(splitIdx).trim();
      }
      return t; // remainder < MAX_CH
    };
    let lastStable = "";
    recognizer.recognizing = (_s, e) => {
      const full = e.result?.translations?.get?.(cfg.targetLanguages[0]) || e.result?.text || "";
      if (!full || full === lastText) return;
      lastText = full;

      // Reset pipeline if Azure restarts the utterance w/ different prefix
      if (!full.startsWith(committed)) {
        committed = ""; ll1Text = ""; ll2Text = ""; hl1Text = ""; hl2Text = "";
        setRow("ov-hl1", ""); setRow("ov-hl2", ""); setRow("ov-ll1", ""); setRow("ov-ll2", "");
      }

      let un = full.slice(committed.length);
      if (!un) return;

      // Flush chunks to rows while exceeding threshold
      const boundary = /[\s,.!?;:，。！？；：]/;
      while (un.length > PROMOTE_CH) {
        // prefer split at last boundary within PROMOTE_CH
        let splitIdx = -1;
        for (let i = Math.min(PROMOTE_CH, un.length - 1); i >= 0; i--) {
          if (boundary.test(un[i])) { splitIdx = i + 1; break; }
        }
        if (splitIdx <= 0) splitIdx = PROMOTE_CH;
        const chunk = un.slice(0, splitIdx).trim();
        if (chunk) {
          // shift: HL1 <- HL2, HL2 <- LL1, LL1 <- chunk
          hl1Text = hl2Text; setRow("ov-hl1", hl1Text);
          hl2Text = ll1Text; setRow("ov-hl2", hl2Text);
          ll1Text = chunk;  setRow("ov-ll1", ll1Text);
          committed += chunk;
        }
        un = un.slice(splitIdx);
      }

      // Remainder stays in LL2 as live
      ll2Text = un;
      redrawLL2(ll2Text);
    };
    recognizer.recognized = (_s, e) => {
      const text = e.result?.translations?.get?.(cfg.targetLanguages[0]) || e.result?.text || "";
      if (!text) return;
      // De-dupe repeated finals
      if (!window.__LAST_FINAL) window.__LAST_FINAL = "";
      if (text === window.__LAST_FINAL && ll1Text === "") return;
      window.__LAST_FINAL = text;

      // Flush any remaining uncommitted text in chunks
      let un = text.slice(committed.length).trim();
      const boundary = /[\s,.!?;:，。！？；：]/;
      while (un.length > 0) {
        let splitIdx = -1;
        for (let i = Math.min(PROMOTE_CH, un.length); i >= 0; i--) {
          if (boundary.test(un[i])) { splitIdx = i + 1; break; }
        }
        if (splitIdx <= 0) splitIdx = Math.min(PROMOTE_CH, un.length);
        const chunk = un.slice(0, splitIdx).trim();
        if (chunk) {
          hl1Text = hl2Text; setRow("ov-hl1", hl1Text);
          hl2Text = ll1Text; setRow("ov-hl2", hl2Text);
          ll1Text = chunk;  setRow("ov-ll1", ll1Text);
          committed += chunk;
        }
        un = un.slice(splitIdx);
      }
      // After final, move LL1→HL2 and clear LL rows
      hl1Text = hl2Text; setRow("ov-hl1", hl1Text);
      hl2Text = ll1Text; setRow("ov-hl2", hl2Text);
      ll1Text = ""; ll2Text = ""; committed = ""; lastStable = "";
      setRow("ov-ll1", ""); setRow("ov-ll2", "");
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

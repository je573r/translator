// Translation object for UI languages
const translations = {
  en: {
    title: "Speech Translator",
    autoDetect: "Auto detect source",
    sourceLanguage: "Source language",
    targetLanguage: "Target language",
    start: "Start",
    stop: "Stop",
    idle: "Idle",
    starting: "Starting...",
    translating: "Translating...",
    stopping: "Stopping...",
    errorStarting: "Error starting",
    errorStopping: "Error stopping"
  },
  es: {
    title: "Traductor de Voz",
    autoDetect: "Detectar fuente automáticamente",
    sourceLanguage: "Idioma de origen",
    targetLanguage: "Idioma de destino",
    start: "Iniciar",
    stop: "Detener",
    idle: "Inactivo",
    starting: "Iniciando...",
    translating: "Traduciendo...",
    stopping: "Deteniendo...",
    errorStarting: "Error al iniciar",
    errorStopping: "Error al detener"
  },
  fr: {
    title: "Traducteur Vocal",
    autoDetect: "Détection automatique de la source",
    sourceLanguage: "Langue source",
    targetLanguage: "Langue cible",
    start: "Démarrer",
    stop: "Arrêter",
    idle: "Inactif",
    starting: "Démarrage...",
    translating: "Traduction...",
    stopping: "Arrêt...",
    errorStarting: "Erreur de démarrage",
    errorStopping: "Erreur d'arrêt"
  },
  de: {
    title: "Sprach-Übersetzer",
    autoDetect: "Quelle automatisch erkennen",
    sourceLanguage: "Quellsprache",
    targetLanguage: "Zielsprache",
    start: "Starten",
    stop: "Stoppen",
    idle: "Bereit",
    starting: "Startet...",
    translating: "Übersetzt...",
    stopping: "Stoppt...",
    errorStarting: "Fehler beim Starten",
    errorStopping: "Fehler beim Stoppen"
  },
  hi: {
    title: "वाक् अनुवादक",
    autoDetect: "स्रोत स्वचालित पहचान",
    sourceLanguage: "स्रोत भाषा",
    targetLanguage: "लक्ष्य भाषा",
    start: "शुरू करें",
    stop: "रोकें",
    idle: "निष्क्रिय",
    starting: "शुरू हो रहा है...",
    translating: "अनुवाद हो रहा है...",
    stopping: "रुक रहा है...",
    errorStarting: "शुरू करने में त्रुटि",
    errorStopping: "रोकने में त्रुटि"
  },
  zh: {
    title: "语音翻译器",
    autoDetect: "自动检测源语言",
    sourceLanguage: "源语言",
    targetLanguage: "目标语言",
    start: "开始",
    stop: "停止",
    idle: "空闲",
    starting: "正在启动...",
    translating: "正在翻译...",
    stopping: "正在停止...",
    errorStarting: "启动错误",
    errorStopping: "停止错误"
  }
};

function updateUILanguage(lang) {
  const t = translations[lang] || translations.en;
  
  // Update text content of UI elements
  document.querySelector('h1').textContent = t.title;
  
  // Update checkbox label
  const autoDetectLabel = document.querySelector('label:has(#autoDetect)');
  if (autoDetectLabel) {
    autoDetectLabel.innerHTML = `<input type="checkbox" id="autoDetect" ${document.getElementById('autoDetect').checked ? 'checked' : ''} /> ${t.autoDetect}`;
    // Re-attach the event listener since we replaced the element
    const newAutoDetect = document.getElementById('autoDetect');
    const fromEl = document.getElementById('fromLang');
    newAutoDetect.addEventListener('change', () => {
      fromEl.disabled = newAutoDetect.checked;
    });
    fromEl.disabled = newAutoDetect.checked;
  }
  
  // Update other labels by finding the text nodes
  const labels = document.querySelectorAll('label');
  labels.forEach(label => {
    if (label.textContent.trim() === 'Source language' || 
        label.textContent.trim() === 'Idioma de origen' || 
        label.textContent.trim() === 'Langue source' ||
        label.textContent.trim() === 'Quellsprache' ||
        label.textContent.trim() === 'स्रोत भाषा' ||
        label.textContent.trim() === '源语言') {
      label.textContent = t.sourceLanguage;
    } else if (label.textContent.trim() === 'Target language' || 
               label.textContent.trim() === 'Idioma de destino' || 
               label.textContent.trim() === 'Langue cible' ||
               label.textContent.trim() === 'Zielsprache' ||
               label.textContent.trim() === 'लक्ष्य भाषा' ||
               label.textContent.trim() === '目标语言') {
      label.textContent = t.targetLanguage;
    }
  });
  
  document.getElementById('startBtn').textContent = t.start;
  document.getElementById('stopBtn').textContent = t.stop;
  
  // Update status if it's currently showing "Idle" or equivalent
  const statusEl = document.getElementById('status');
  const currentStatus = statusEl.textContent;
  if (currentStatus === 'Idle' || currentStatus === translations.en.idle || 
      Object.values(translations).some(trans => currentStatus === trans.idle)) {
    statusEl.textContent = t.idle;
  }
  
  // Store current language for status updates
  window.currentUILang = lang;
}

function getTranslatedStatus(key) {
  const lang = window.currentUILang || 'en';
  const t = translations[lang] || translations.en;
  return t[key] || key;
}

async function main() {
  const autoDetectEl = document.getElementById("autoDetect");
  const fromEl = document.getElementById("fromLang");
  const toEl = document.getElementById("toLang");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const statusEl = document.getElementById("status");
  const uiLangEl = document.getElementById("uiLang");

  // Initialize dropdown enabled/disabled based on checkbox state
  fromEl.disabled = autoDetectEl.checked;

  autoDetectEl.addEventListener("change", () => {
    fromEl.disabled = autoDetectEl.checked;
  });

  // UI Language functionality with translation
  uiLangEl.addEventListener("change", () => {
    updateUILanguage(uiLangEl.value);
  });

  // Initialize UI language
  updateUILanguage(uiLangEl.value);

  let stopAzureFn = null;

  const setStatus = (statusKey) => {
    statusEl.textContent = getTranslatedStatus(statusKey);
  };

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true; stopBtn.disabled = false; setStatus("starting");
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
      setStatus("translating");
    } catch (e) {
      console.error(e); setStatus("errorStarting");
      startBtn.disabled = false; stopBtn.disabled = true;
    }
  });

  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true; setStatus("stopping");
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
      setStatus("idle");
    } catch (e) { console.error(e); setStatus("errorStopping"); }
    startBtn.disabled = false; stopBtn.disabled = true;
  });
}

main();



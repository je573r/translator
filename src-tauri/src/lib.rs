#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![start_system_capture, stop_system_capture, list_input_devices, get_azure_token])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};
use base64::Engine;
use std::env;

static CAPTURE_STATE: Lazy<Arc<Mutex<Option<CaptureWorker>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

struct CaptureWorker {
  stop_tx: crossbeam_channel::Sender<()>,
}

#[tauri::command]
fn start_system_capture(app: tauri::AppHandle, output_wav_path: Option<String>) -> Result<String, String> {
  let mut state = CAPTURE_STATE.lock().unwrap();
  if state.is_some() {
    return Ok("already capturing".into());
  }

  // Resolve an absolute output path that's easy to find
  let resolved_path = if let Some(p) = output_wav_path {
    std::path::PathBuf::from(p)
  } else {
    // Prefer Downloads dir; fallback to Home/Downloads, then app local data dir
    let base = app
      .path()
      .download_dir()
      .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
      .or_else(|_| app.path().app_local_data_dir())
      .map_err(|_| "Could not resolve an output directory".to_string())?;
    base.join("system_capture.wav")
  };

  if let Some(parent) = resolved_path.parent() {
    if !parent.exists() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
  }

  // Ensure a file becomes visible immediately
  {
    let _ = std::fs::File::create(&resolved_path).map_err(|e| e.to_string())?;
  }

  log::info!("System capture writing to: {:?}", resolved_path);
  let (stop_tx, stop_rx) = crossbeam_channel::unbounded::<()>();

  let out_path_string = resolved_path.to_string_lossy().to_string();
  let path_for_thread = out_path_string.clone();
  let app_handle = app.clone();
  thread::Builder::new()
    .name("wasapi_loopback_capture".into())
    .spawn(move || {
      if let Err(e) = capture_wasapi_loopback(path_for_thread.as_str(), stop_rx, Some(app_handle)) {
        log::error!("capture error: {}", e);
      }
    })
    .map_err(|e| e.to_string())?;

  *state = Some(CaptureWorker { stop_tx });
  Ok(out_path_string)
}

#[tauri::command]
fn list_input_devices() -> Result<Vec<String>, String> {
  use cpal::traits::{DeviceTrait, HostTrait};
  let host = cpal::host_from_id(cpal::HostId::Wasapi).map_err(|e| e.to_string())?;
  let mut names = Vec::new();
  for dev in host.input_devices().map_err(|e| e.to_string())? {
    if let Ok(name) = dev.name() { names.push(name); }
  }
  Ok(names)
}

#[tauri::command]
fn get_azure_token() -> Result<String, String> {
  let key = env::var("AZURE_SPEECH_KEY").map_err(|_| "AZURE_SPEECH_KEY not set".to_string())?;
  let region = env::var("AZURE_SPEECH_REGION").map_err(|_| "AZURE_SPEECH_REGION not set".to_string())?;
  let url = format!("https://{}.api.cognitive.microsoft.com/sts/v1.0/issueToken", region);
  let client = reqwest::blocking::Client::new();
  let resp = client
    .post(&url)
    .header("Ocp-Apim-Subscription-Key", key)
    .header("Content-Length", "0")
    .body("")
    .send()
    .map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("token request failed: {}", resp.status()));
  }
  let token = resp.text().map_err(|e| e.to_string())?;
  Ok(token)
}

#[tauri::command]
fn stop_system_capture() -> Result<(), String> {
  let mut state = CAPTURE_STATE.lock().unwrap();
  if let Some(worker) = state.take() {
    let _ = worker.stop_tx.send(());
  }
  Ok(())
}

fn capture_wasapi_loopback(path: &str, stop_rx: crossbeam_channel::Receiver<()>, app: Option<tauri::AppHandle>) -> Result<(), String> {
  use hound::{SampleFormat as HSampleFormat, WavSpec, WavWriter};
  use windows::Win32::Media::Audio::*;
  use windows::Win32::System::Com::*;

  // WAV writer in API-friendly format: 16 kHz mono PCM16
  let spec = WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 16, sample_format: HSampleFormat::Int };
  let writer = &mut WavWriter::create(path, spec).map_err(|e| e.to_string())?;

  unsafe {
    CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| format!("CoInitializeEx: {e}"))?;
  }

  let current_device_id_cell: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
  let current_device_id_for_open = current_device_id_cell.clone();
  let mut open_loopback = move || -> Result<(IAudioClient, IAudioCaptureClient, u32, u16, bool), String> {
    unsafe {
      let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
        .map_err(|e| format!("CoCreateInstance: {e}"))?;
      let device: IMMDevice = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
        .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;
      // Save device id for change detection
      let id = device.GetId().map_err(|e| format!("GetId: {e}"))?;
      let id_str = id.to_string().unwrap_or_default();
      if let Ok(mut g) = current_device_id_for_open.lock() { *g = Some(id_str); }

      let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| format!("Activate IAudioClient: {e}"))?;
      let pwfx = client.GetMixFormat().map_err(|e| format!("GetMixFormat: {e}"))?;
      if pwfx.is_null() { return Err("Mix format is null".into()); }
      let wfx = *pwfx;
      let extensible = wfx.wFormatTag == 0xFFFEu16; // WAVE_FORMAT_EXTENSIBLE
      let (channels, sample_rate, is_float) = if extensible {
        let wfxe = *(pwfx as *const WAVEFORMATEXTENSIBLE);
        // If extensible and valid mask/subformat, treat IEEE float if 32-bit
        (wfxe.Format.nChannels, wfxe.Format.nSamplesPerSec, wfxe.Format.wBitsPerSample == 32)
      } else {
        (wfx.nChannels, wfx.nSamplesPerSec, wfx.wBitsPerSample == 32)
      };

      // Initialize for loopback shared mode
      let flags = AUDCLNT_STREAMFLAGS_LOOPBACK;
      client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, pwfx, None)
        .map_err(|e| format!("IAudioClient.Initialize: {e}"))?;

      // free mix format
      CoTaskMemFree(Some(pwfx as *const _ as *mut _));

      let capture: IAudioCaptureClient = client
        .GetService::<IAudioCaptureClient>()
        .map_err(|e| format!("GetService IAudioCaptureClient: {e}"))?;
      Ok((client, capture, sample_rate, channels, is_float))
    }
  };

  let mut open = open_loopback()?;
  unsafe { open.0.Start().map_err(|e| format!("Start: {e}"))?; }

  let mut last_check = std::time::Instant::now();
  let mut temp: Vec<i16> = Vec::with_capacity(8192);
  let mut emit_buf: Vec<i16> = Vec::with_capacity(9600); // buffer for 16k PCM frames to emit in 20ms chunks

  loop {
    if stop_rx.try_recv().is_ok() { break; }

    // device change check every second
    if last_check.elapsed() > std::time::Duration::from_secs(1) {
      last_check = std::time::Instant::now();
      unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
          .map_err(|e| format!("CoCreateInstance: {e}"))?;
        let device: IMMDevice = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)
          .map_err(|e| format!("GetDefaultAudioEndpoint: {e}"))?;
        let id = device.GetId().map_err(|e| format!("GetId: {e}"))?;
        let id_str = id.to_string().unwrap_or_default();
        let cur = current_device_id_cell.lock().ok().and_then(|g| g.clone());
        if Some(id_str.clone()) != cur {
          log::info!("Render device changed; reopening loopback");
          // Stop and reopen
          let _ = open.0.Stop();
          open = open_loopback()?;
          open.0.Start().map_err(|e| format!("Start: {e}"))?;
        }
      }
    }

    unsafe {
      let pkt_len = open.1.GetNextPacketSize().unwrap_or(0);
      if pkt_len == 0 { thread::sleep(Duration::from_millis(5)); continue; }

      let mut data_ptr: *mut u8 = std::ptr::null_mut();
      let mut num_frames: u32 = 0;
      let mut flags: u32 = 0;
      let mut dev_pos: u64 = 0;
      let mut qpc_pos: u64 = 0;
      open.1.GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, Some(&mut dev_pos), Some(&mut qpc_pos))
        .map_err(|e| format!("GetBuffer: {e}"))?;

      // Convert to mono i16 and naive-resample to 16k
      if !data_ptr.is_null() && num_frames > 0 {
        temp.clear();
        if open.4 { // float32
          let slice = std::slice::from_raw_parts(data_ptr as *const f32, (num_frames * open.3 as u32) as usize);
          let mut i = 0usize;
          while i + open.3 as usize <= slice.len() {
            let mut sum = 0.0f32;
            for c in 0..open.3 { sum += slice[i + c as usize]; }
            let mono = ((sum / open.3 as f32).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            temp.push(mono);
            i += open.3 as usize;
          }
        } else { // int16
          let slice = std::slice::from_raw_parts(data_ptr as *const i16, (num_frames * open.3 as u32) as usize);
          let mut i = 0usize;
          while i + open.3 as usize <= slice.len() {
            let mut sum = 0i32;
            for c in 0..open.3 { sum += slice[i + c as usize] as i32; }
            let mono = (sum / open.3 as i32) as i16;
            temp.push(mono);
            i += open.3 as usize;
          }
        }

        // Resample to 16k mono buffer used for both WAV and Azure push
        let mut out16k: Vec<i16> = Vec::with_capacity(temp.len());
        if open.2 == 16_000 {
          out16k.extend_from_slice(&temp);
        } else {
          let ratio = open.2 as f32 / 16_000.0;
          let mut acc = 0.0f32;
          while (acc as usize) < temp.len() {
            out16k.push(temp[acc as usize]);
            acc += ratio;
          }
        }

        // Write WAV
        for s in &out16k { writer.write_sample(*s).map_err(|e| e.to_string())?; }

        // Emit to frontend as 20 ms frames (320 samples)
        if let Some(ref handle) = app {
          emit_buf.extend_from_slice(&out16k);
          while emit_buf.len() >= 320 {
            let mut bytes: Vec<u8> = Vec::with_capacity(640);
            for v in emit_buf.iter().take(320) { bytes.extend_from_slice(&v.to_le_bytes()); }
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let _ = handle.emit("pcm-frame", &serde_json::json!({"b64": b64}));
            emit_buf.drain(0..320);
          }
        }
      }

      open.1.ReleaseBuffer(num_frames).map_err(|e| format!("ReleaseBuffer: {e}"))?;
    }
  }

  unsafe { let _ = open.0.Stop(); }
  writer.flush().map_err(|e| e.to_string())?;
  Ok(())
}

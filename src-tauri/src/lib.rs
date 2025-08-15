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
    .invoke_handler(tauri::generate_handler![start_system_capture, stop_system_capture, list_input_devices])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;

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
  thread::Builder::new()
    .name("wasapi_loopback_capture".into())
    .spawn(move || {
      if let Err(e) = capture_wasapi_loopback(path_for_thread.as_str(), stop_rx) {
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
fn stop_system_capture() -> Result<(), String> {
  let mut state = CAPTURE_STATE.lock().unwrap();
  if let Some(worker) = state.take() {
    let _ = worker.stop_tx.send(());
  }
  Ok(())
}

fn capture_wasapi_loopback(path: &str, stop_rx: crossbeam_channel::Receiver<()>) -> Result<(), String> {
  // Capture from an input device using CPAL. To record system audio, select a loopback input
  // such as "Stereo Mix" or a virtual cable. We try to pick one automatically; otherwise use default mic.
  use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
  use cpal::{Sample, SampleFormat};
  use hound::{SampleFormat as HSampleFormat, WavSpec, WavWriter};

  let host = cpal::host_from_id(cpal::HostId::Wasapi).map_err(|e| e.to_string())?;

  // Try to find a loopback-like input
  let mut preferred: Option<cpal::Device> = None;
  for dev in host.input_devices().map_err(|e| e.to_string())? {
    if let Ok(name) = dev.name() {
      let lname = name.to_lowercase();
      if lname.contains("stereo mix") || lname.contains("loopback") || lname.contains("cable output") {
        preferred = Some(dev);
        break;
      }
    }
  }
  let device = preferred.or_else(|| host.default_input_device()).ok_or_else(|| "No input device available".to_string())?;

  let default_cfg = device.default_input_config().map_err(|e| e.to_string())?;
  let mut cfg = default_cfg.config();
  cfg.channels = cfg.channels.max(1).min(2); // 1 or 2 channels
  cfg.sample_rate = cpal::SampleRate(cfg.sample_rate.0.min(48_000).max(16_000));

  let spec = WavSpec { channels: cfg.channels, sample_rate: cfg.sample_rate.0, bits_per_sample: 16, sample_format: HSampleFormat::Int };
  let writer = Arc::new(Mutex::new(WavWriter::create(path, spec).map_err(|e| e.to_string())?));

  let writer_cb = writer.clone();
  let err_fn = |err| log::error!("CPAL stream error: {err}");

  let sample_format = default_cfg.sample_format();
  let stream = match sample_format {
    SampleFormat::F32 => {
      let writer_cb = writer_cb.clone();
      device.build_input_stream(&cfg, move |data: &[f32], _| {
        if let Ok(mut w) = writer_cb.lock() {
          for &s in data { let v: i16 = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16; let _ = w.write_sample(v); }
        }
      }, err_fn, None)
    }
    SampleFormat::I16 => {
      let writer_cb = writer_cb.clone();
      device.build_input_stream(&cfg, move |data: &[i16], _| {
        if let Ok(mut w) = writer_cb.lock() { for &s in data { let _ = w.write_sample(s); } }
      }, err_fn, None)
    }
    SampleFormat::U16 => {
      let writer_cb = writer_cb.clone();
      device.build_input_stream(&cfg, move |data: &[u16], _| {
        if let Ok(mut w) = writer_cb.lock() { for &s in data { let v: i16 = (s as i32 - 32768) as i16; let _ = w.write_sample(v); } }
      }, err_fn, None)
    }
    _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
  }.map_err(|e| e.to_string())?;

  stream.play().map_err(|e| e.to_string())?;

  while stop_rx.try_recv().is_err() { thread::sleep(Duration::from_millis(50)); }
  drop(stream);
  if let Ok(mut w) = writer.lock() { w.flush().map_err(|e| e.to_string())?; }
  Ok(())
}

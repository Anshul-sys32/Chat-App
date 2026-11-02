import { useCallback, useEffect, useRef, useState } from "react";
import { FaCamera, FaMicrophone, FaStop } from "react-icons/fa";
import { listAudioRoutes } from "../audioRouting";
import {
  readMediaDevicePreferences,
  saveMediaDevicePreferences,
} from "../mediaDevicePreferences";

const captureConstraints = (deviceId) => deviceId ? { deviceId: { ideal: deviceId } } : true;

export default function MediaDeviceSettings({ userId }) {
  const [preferences, setPreferences] = useState(() => readMediaDevicePreferences(userId));
  const [inputDevices, setInputDevices] = useState({ audio: [], video: [] });
  const [audioRoutes, setAudioRoutes] = useState([]);
  const [testMode, setTestMode] = useState("");
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [error, setError] = useState("");
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const audioContextRef = useRef(null);
  const animationFrameRef = useRef(0);
  const testRequestRef = useRef(0);
  const isMountedRef = useRef(false);

  const refreshDevices = useCallback(async () => {
    setError("");
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError("This browser or device does not expose media device selection.");
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!isMountedRef.current) return;
      setInputDevices({
        audio: devices.filter((device) => device.kind === "audioinput"),
        video: devices.filter((device) => device.kind === "videoinput"),
      });
      try {
        const routes = await listAudioRoutes();
        if (isMountedRef.current) setAudioRoutes(routes);
      } catch {
        if (isMountedRef.current) setAudioRoutes([]);
      }
    } catch (deviceError) {
      if (isMountedRef.current) setError(deviceError.message || "Could not list media devices.");
    }
  }, []);

  const stopTest = () => {
    testRequestRef.current += 1;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setTestMode("");
    setMicrophoneLevel(0);
  };

  useEffect(() => {
    isMountedRef.current = true;
    refreshDevices();
    const onDeviceChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      isMountedRef.current = false;
      testRequestRef.current += 1;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      window.cancelAnimationFrame(animationFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioContextRef.current?.close().catch(() => {});
    };
  }, [refreshDevices]);

  const updatePreference = (key, value) => {
    stopTest();
    try {
      const next = saveMediaDevicePreferences(userId, { ...preferences, [key]: value });
      setPreferences(next);
    } catch (storageError) {
      setError(storageError.message || "Could not save this device preference.");
    }
  };

  const startTest = async (mode) => {
    if (testMode === mode) {
      stopTest();
      return;
    }
    stopTest();
    setError("");
    const requestId = ++testRequestRef.current;
    setTestMode(`${mode}-requesting`);
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setTestMode("");
      setError("Microphone and camera testing is not supported by this browser or device.");
      return;
    }
    let microphoneContext = null;
    if (mode === "audio") {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          microphoneContext = new AudioContextClass();
          if (microphoneContext.state === "suspended") microphoneContext.resume().catch(() => {});
        } catch {
          microphoneContext = null;
        }
      }
    }
    try {
      const stream = await mediaDevices.getUserMedia(mode === "audio"
        ? { audio: captureConstraints(preferences.audioInputId), video: false }
        : { audio: false, video: captureConstraints(preferences.videoInputId) });
      if (requestId !== testRequestRef.current || !isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        microphoneContext?.close().catch(() => {});
        return;
      }
      streamRef.current = stream;
      setTestMode(mode);
      await refreshDevices();
      if (mode === "video" && videoRef.current) videoRef.current.srcObject = stream;
      if (mode === "audio") {
        if (!microphoneContext) return;
        audioContextRef.current = microphoneContext;
        const source = microphoneContext.createMediaStreamSource(stream);
        const analyser = microphoneContext.createAnalyser();
        const samples = new Uint8Array(analyser.fftSize);
        source.connect(analyser);
        let lastUpdate = 0;
        const updateLevel = (timestamp) => {
          analyser.getByteTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            energy += normalized * normalized;
          }
          if (timestamp - lastUpdate > 100) {
            setMicrophoneLevel(Math.min(100, Math.round(Math.sqrt(energy / samples.length) * 250)));
            lastUpdate = timestamp;
          }
          animationFrameRef.current = window.requestAnimationFrame(updateLevel);
        };
        animationFrameRef.current = window.requestAnimationFrame(updateLevel);
      }
    } catch (deviceError) {
      microphoneContext?.close().catch(() => {});
      if (requestId !== testRequestRef.current || !isMountedRef.current) return;
      stopTest();
      setError(deviceError.name === "NotAllowedError"
        ? "Permission was denied. Allow access in device settings and try again."
        : deviceError.name === "NotFoundError"
          ? `No ${mode === "audio" ? "microphone" : "camera"} was found.`
          : deviceError.message || "Could not start this device test.");
    }
  };

  const saveSelect = (key) => (event) => updatePreference(key, event.target.value);
  const deviceName = (device, index, kind) => device.label || `${kind} ${index + 1}`;

  return (
    <section className="min-w-0 space-y-5 text-white" aria-labelledby="media-device-settings-title">
      <div>
        <h2 id="media-device-settings-title" className="text-base font-semibold">Audio &amp; video devices</h2>
        <p className="mt-1 text-xs text-white/60">Device preferences stay on this device.</p>
      </div>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <label className="block space-y-1.5 text-sm">
        <span>Microphone</span>
        <select value={preferences.audioInputId} onChange={saveSelect("audioInputId")} className="glass-input theme-text min-w-0 w-full max-w-full rounded-md p-2.5">
          <option value="">System default</option>
          {inputDevices.audio.map((device, index) => (
            <option key={device.deviceId || `audio-${index}`} value={device.deviceId}>{deviceName(device, index, "Microphone")}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => startTest("audio")} disabled={testMode === "audio-requesting"} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:border-teal-300 disabled:opacity-50">
        {testMode === "audio" ? <FaStop /> : <FaMicrophone />}
        {testMode === "audio" ? "Stop microphone test" : testMode === "audio-requesting" ? "Requesting microphone…" : "Test microphone"}
      </button>
      {testMode === "audio" && (
        <div>
          <label htmlFor="microphone-level" className="mb-1 block text-xs text-white/65">Microphone level</label>
          {audioContextRef.current
            ? <progress id="microphone-level" max="100" value={microphoneLevel} className="h-2 w-full accent-teal-400" />
            : <p role="status" className="text-xs text-white/60">Level metering is unavailable on this device.</p>}
        </div>
      )}
      <label className="block space-y-1.5 text-sm">
        <span>Camera</span>
        <select value={preferences.videoInputId} onChange={saveSelect("videoInputId")} className="glass-input theme-text min-w-0 w-full max-w-full rounded-md p-2.5">
          <option value="">System default</option>
          {inputDevices.video.map((device, index) => (
            <option key={device.deviceId || `video-${index}`} value={device.deviceId}>{deviceName(device, index, "Camera")}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => startTest("video")} disabled={testMode === "video-requesting"} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:border-teal-300 disabled:opacity-50">
        {testMode === "video" ? <FaStop /> : <FaCamera />}
        {testMode === "video" ? "Stop camera preview" : testMode === "video-requesting" ? "Requesting camera…" : "Preview camera"}
      </button>
      {testMode === "video" && (
        <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full rounded-md bg-black object-cover" />
      )}
      <label className="block space-y-1.5 text-sm">
        <span>Speaker</span>
        <select value={preferences.audioOutputId} onChange={saveSelect("audioOutputId")} className="glass-input theme-text min-w-0 w-full max-w-full rounded-md p-2.5">
          <option value="">System default</option>
          {audioRoutes.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}
        </select>
      </label>
      <p className="text-xs text-white/60">Speaker selection is applied when a call starts. Device availability varies by browser and Android version.</p>
      <button type="button" onClick={refreshDevices} className="text-xs text-teal-300 hover:underline">Refresh devices</button>
    </section>
  );
}

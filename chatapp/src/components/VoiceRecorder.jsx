import { useEffect, useRef, useState } from "react";
import { FaMicrophone, FaPause, FaPlay, FaStop, FaTrash } from "react-icons/fa";
import { readMediaDevicePreferences } from "../mediaDevicePreferences";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const FORMAT_OPTIONS = [
  ["audio/webm;codecs=opus", "audio/webm", ".webm"],
  ["audio/ogg;codecs=opus", "audio/ogg", ".ogg"],
  ["audio/mp4", "audio/mp4", ".m4a"],
  ["audio/mpeg", "audio/mpeg", ".mp3"],
  ["audio/wav", "audio/wav", ".wav"],
];

const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function VoiceRecorder({ onRecorded, onClose, maxDurationSeconds = 300 }) {
  const [recorderState, setRecorderState] = useState("idle");
  const [duration, setDuration] = useState(0);
  const [recordingFile, setRecordingFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const cancelRef = useRef(false);
  const chunksRef = useRef([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!recordingFile) {
      setPreviewUrl("");
      return undefined;
    }
    const url = URL.createObjectURL(recordingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordingFile]);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const stopTracks = () => {
    window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    setError("");
    setRecordingFile(null);
    setDuration(0);
    elapsedBeforePauseRef.current = 0;
    cancelRef.current = false;
    const requestId = ++requestIdRef.current;
    setRecorderState("requesting");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecorderState("idle");
      setError("Voice recording is not supported by this browser or device.");
      return;
    }
    try {
      const preferredMicrophone = readMediaDevicePreferences().audioInputId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: preferredMicrophone ? { deviceId: { ideal: preferredMicrophone } } : true,
      });
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const supportedFormat = FORMAT_OPTIONS.find(([type]) => MediaRecorder.isTypeSupported(type));
      const recorder = supportedFormat
        ? new MediaRecorder(stream, { mimeType: supportedFormat[0] })
        : new MediaRecorder(stream);
      const actualType = recorder.mimeType.split(";")[0].toLowerCase();
      const fileFormat = FORMAT_OPTIONS.find(([, mimeType]) => mimeType === actualType);
      if (!fileFormat) {
        stopTracks();
        setError("This device's recording format is not supported for sending.");
        return;
      }
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("Recording stopped because the microphone reported an error.");
        setRecorderState("idle");
        stopTracks();
      };
      recorder.onstop = () => {
        stopTracks();
        setRecorderState("idle");
        if (cancelRef.current) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: fileFormat[1] });
        if (!blob.size) {
          setError("No audio was captured. Check microphone access and try again.");
          return;
        }
        if (blob.size > MAX_FILE_SIZE) {
          setError("This recording is larger than the 20 MB limit. Make a shorter recording.");
          return;
        }
        const file = new File([blob], `voice-message${fileFormat[2]}`, { type: fileFormat[1] });
        setRecordingFile(file);
      };
      recorder.start(250);
      startedAtRef.current = Date.now();
      setRecorderState("recording");
      timerRef.current = window.setInterval(() => {
        const activeSeconds = recorder.state === "paused"
          ? elapsedBeforePauseRef.current
          : elapsedBeforePauseRef.current + (Date.now() - startedAtRef.current) / 1000;
        const elapsed = Math.floor(activeSeconds);
        setDuration(Math.min(elapsed, maxDurationSeconds));
        if (elapsed >= maxDurationSeconds && recorder.state !== "inactive") recorder.stop();
      }, 250);
    } catch (recordingError) {
      if (requestId !== requestIdRef.current) return;
      stopTracks();
      setRecorderState("idle");
      setError(recordingError.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow access in your browser or device settings and try again."
        : recordingError.name === "NotFoundError"
          ? "No microphone was found on this device."
          : "Could not start the microphone. Check its permission and try again.");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      elapsedBeforePauseRef.current += (Date.now() - startedAtRef.current) / 1000;
      setDuration(Math.min(Math.floor(elapsedBeforePauseRef.current), maxDurationSeconds));
    }
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const cancelRecording = () => {
    requestIdRef.current += 1;
    cancelRef.current = true;
    setRecordingFile(null);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      stopTracks();
      setRecorderState("idle");
    }
  };

  const confirmRecording = () => {
    if (!recordingFile) return;
    onRecorded(recordingFile, duration);
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-recorder-title"
        className="theme-sidebar w-full max-w-md rounded-xl border p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="voice-recorder-title" className="text-lg font-semibold">Voice message</h2>
          <button type="button" onClick={() => { cancelRecording(); onClose(); }} aria-label="Close voice recorder" className="chat-action rounded-lg border px-3 py-2">Close</button>
        </div>
        <div className="my-6 flex items-center justify-center gap-3" aria-live="polite">
          <span className={`h-3 w-3 rounded-full ${recorderState === "recording" ? "animate-pulse bg-rose-500" : "bg-slate-400"}`} />
          <span className="font-mono text-2xl tabular-nums">{formatTime(duration)}</span>
          <span className="theme-muted text-sm">
            {recorderState === "recording" ? "Recording" : recorderState === "paused" ? "Paused" : "Ready"}
          </span>
        </div>
        {recordingFile && previewUrl && (
          <div className="mb-4 space-y-3">
            <audio controls preload="metadata" src={previewUrl} className="w-full">Audio preview is unavailable.</audio>
            <p className="theme-muted text-xs">Preview before adding this recording to your message.</p>
          </div>
        )}
        {error && <p role="alert" className="mb-4 text-sm text-rose-400">{error}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          {recorderState === "idle" && !recordingFile && (
            <button type="button" onClick={startRecording} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 font-semibold text-white">
              <FaMicrophone /> Start recording
            </button>
          )}
          {recorderState === "recording" && (
            <>
              <button type="button" onClick={() => {
                elapsedBeforePauseRef.current += (Date.now() - startedAtRef.current) / 1000;
                setDuration(Math.min(Math.floor(elapsedBeforePauseRef.current), maxDurationSeconds));
                recorderRef.current?.pause();
                setRecorderState("paused");
              }} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2">
                <FaPause /> Pause
              </button>
              <button type="button" onClick={stopRecording} className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 font-semibold text-slate-950">
                <FaStop /> Stop
              </button>
            </>
          )}
          {recorderState === "paused" && (
            <>
              <button type="button" onClick={() => {
                startedAtRef.current = Date.now();
                recorderRef.current?.resume();
                setRecorderState("recording");
              }} className="inline-flex items-center gap-2 rounded-lg border px-4 py-2">
                <FaPlay /> Resume
              </button>
              <button type="button" onClick={stopRecording} className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 font-semibold text-slate-950">
                <FaStop /> Stop
              </button>
            </>
          )}
          {(recorderState !== "idle" || recordingFile) && (
            <button type="button" onClick={cancelRecording} className="inline-flex items-center gap-2 rounded-lg border border-rose-400/40 px-4 py-2 text-rose-400">
              <FaTrash /> Discard
            </button>
          )}
          {recordingFile && (
            <button type="button" onClick={confirmRecording} className="rounded-lg bg-teal-500 px-4 py-2 font-semibold text-slate-950">
              Add recording
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
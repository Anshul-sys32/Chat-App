import { useRef, useState } from "react";
import { FaPause, FaPlay, FaRedoAlt } from "react-icons/fa";

const PLAYBACK_RATES = [1, 1.5, 2];
const WAVEFORM_BARS = Array.from({ length: 32 }, (_, index) => 16 + ((index * 17 + index * index * 3) % 25));

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
};

export default function VoiceMessagePlayer({ src, mimeType, duration: expectedDuration }) {
  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(Number(expectedDuration) || 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setError("");
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
        setError("Could not play this recording. Check audio permission or try again.");
      }
    } else {
      audio.pause();
    }
  };

  const seek = (event) => {
    const nextTime = Number(event.target.value);
    if (!audioRef.current || !Number.isFinite(nextTime)) return;
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const changePlaybackRate = (event) => {
    const nextRate = Number(event.target.value);
    if (!PLAYBACK_RATES.includes(nextRate)) return;
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const retry = () => {
    if (!audioRef.current) return;
    setError("");
    setIsLoading(true);
    audioRef.current.load();
  };

  return (
    <div className="w-[min(19rem,100%)]" aria-label="Voice message player">
      <audio
        ref={audioRef}
        preload="metadata"
        crossOrigin="use-credentials"
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
          setIsLoading(false);
        }}
        onCanPlay={() => setIsLoading(false)}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => { setIsPlaying(true); setIsLoading(false); }}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
        onError={() => {
          setIsPlaying(false);
          setIsLoading(false);
          setError("This voice recording could not be loaded or is no longer available.");
        }}
        className="sr-only"
      >
        <source src={src} type={mimeType} />
        Audio playback is not supported by this browser.
      </audio>
      {error ? (
        <div className="flex items-center gap-2 text-sm" role="alert">
          <span className="min-w-0 flex-1 text-rose-300">{error}</span>
          <button type="button" onClick={retry} aria-label="Retry voice message" title="Retry" className="shrink-0 rounded p-1 hover:text-teal-300">
            <FaRedoAlt />
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlayback}
              disabled={isLoading && !duration}
              aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-500 text-slate-950 disabled:opacity-50"
            >
              {isLoading ? <span className="text-[10px]">…</span> : isPlaying ? <FaPause /> : <FaPlay />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="relative flex h-9 items-center rounded focus-within:ring-2 focus-within:ring-teal-400" aria-label="Voice message timeline">
                <div className="pointer-events-none flex h-8 w-full items-center justify-between gap-[2px] px-1" aria-hidden="true">
                  {WAVEFORM_BARS.map((height, index) => (
                    <span
                      key={index}
                      className={`w-[3px] shrink-0 rounded-full ${index / WAVEFORM_BARS.length <= progress ? "bg-teal-300" : "bg-current opacity-35"}`}
                      style={{ height: `${height}px` }}
                    />
                  ))}
                </div>
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.1"
                  value={Math.min(currentTime, duration || currentTime)}
                  onChange={seek}
                  disabled={!duration}
                  aria-label="Seek voice message"
                  aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
                />
              </div>
            </div>
            <span className="shrink-0 font-mono text-xs tabular-nums" aria-live="off">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <div className="mt-1 flex justify-end">
            <label className="flex items-center gap-1 text-xs">
              <span className="theme-muted">Speed</span>
              <select
                value={playbackRate}
                onChange={changePlaybackRate}
                aria-label="Voice message playback speed"
                className="rounded border border-current/20 bg-transparent px-1.5 py-0.5"
              >
                {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
              </select>
            </label>
          </div>
        </>
      )}
    </div>
  );
}

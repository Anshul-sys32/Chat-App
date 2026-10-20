import { useEffect, useRef, useState } from "react";
import { FaExpand, FaPhone, FaPhoneSlash, FaVolumeUp, FaWindowMinimize } from "react-icons/fa";
import Socket from "../Socket";
import { listAudioRoutes, selectAudioRoute } from "../audioRouting";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

export default function VideoCall({ to, peerName, callType, isOpen, onClose }) {
  const localVideo = useRef();
  const remoteVideo = useRef();
  const remoteAudio = useRef();
  const pc = useRef(null);
  const localStream = useRef(null);
  const remoteStream = useRef(null);
  const pendingCandidates = useRef([]);
  const remoteUserId = useRef(null);
  const currentTo = useRef(to);
  const currentPeerName = useRef(peerName);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState("");
  const [calling, setCalling] = useState(false);
  const [callStatus, setCallStatus] = useState("Ready to call");
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [activeCallType, setActiveCallType] = useState(callType);
  const [callPeerName, setCallPeerName] = useState(peerName);
  const [visible, setVisible] = useState(isOpen);
  const [minimized, setMinimized] = useState(false);
  const [hasLocalMedia, setHasLocalMedia] = useState(false);
  const [hasRemoteMedia, setHasRemoteMedia] = useState(false);
  const [selfViewPosition, setSelfViewPosition] = useState(null);
  const [audioRoutes, setAudioRoutes] = useState([]);
  const [selectedAudioRoute, setSelectedAudioRoute] = useState("");
  const [audioRouteError, setAudioRouteError] = useState("");
  const [showAudioRoutes, setShowAudioRoutes] = useState(false);
  const callHistoryId = useRef(null);
  const [minimizedPosition, setMinimizedPosition] = useState(null);

  currentTo.current = to;
  currentPeerName.current = peerName;
  onCloseRef.current = onClose;
  const displayPeerName = callPeerName || peerName || "Private call";
  useEffect(() => setVisible(isOpen), [isOpen]);
  useEffect(() => {
    if (!pc.current && !incomingOffer) setActiveCallType(callType);
  }, [callType, incomingOffer]);
  useEffect(() => {
    if (activeCallType === "video" && localVideo.current && localStream.current) {
      localVideo.current.srcObject = localStream.current;
    }
  }, [activeCallType, hasLocalMedia, visible]);
  useEffect(() => {
    if (remoteVideo.current && remoteStream.current) {
      remoteVideo.current.srcObject = remoteStream.current;
    }
    if (activeCallType === "audio" && remoteAudio.current && remoteStream.current) {
      remoteAudio.current.srcObject = remoteStream.current;
    }
  }, [activeCallType, hasRemoteMedia, incomingOffer, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    const loadRoutes = async () => {
      try {
        const routes = await listAudioRoutes();
        if (active) {
          setAudioRoutes(routes);
          if (routes.length && !selectedAudioRoute) setSelectedAudioRoute(routes[0].id);
        }
      } catch (routeError) {
        if (active) setAudioRouteError(routeError.message || "Could not load audio outputs.");
      }
    };
    loadRoutes();
    const refresh = () => loadRoutes();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [visible, selectedAudioRoute]);

  const changeAudioRoute = async (event) => {
    const routeId = event.target.value;
    setAudioRouteError("");
    try {
      await selectAudioRoute(routeId, [remoteAudio.current, remoteVideo.current]);
      setSelectedAudioRoute(routeId);
    } catch (routeError) {
      setAudioRouteError(routeError.message || "Could not switch audio output.");
    }
  };

  const ensureLocalMedia = async (mediaType) => {
    if (!localStream.current) {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        const message = window.isSecureContext
          ? `This browser does not support ${mediaType === "audio" ? "microphone" : "camera and microphone"} access for calls.`
          : "Calls require a secure HTTPS connection. Open this app over HTTPS and allow microphone access.";
        throw new Error(message);
      }
      localStream.current = await mediaDevices.getUserMedia({
        video: mediaType === "video",
        audio: true,
      });
    }
    setHasLocalMedia(true);
    if (mediaType === "video" && localVideo.current) localVideo.current.srcObject = localStream.current;
    return localStream.current;
  };

  useEffect(() => {
    const positionSelfView = () => {
      const width = Math.min(420, Math.max(160, window.innerWidth * 0.35));
      const height = width * 9 / 16;
      setSelfViewPosition((position) => {
        const maxX = Math.max(8, window.innerWidth - width - 8);
        const maxY = Math.max(8, window.innerHeight - height - 8);
        return position
          ? { x: Math.min(position.x, maxX), y: Math.min(position.y, maxY) }
          : { x: Math.max(16, maxX - 12), y: Math.max(80, maxY - 104) };
      });
    };
    positionSelfView();
    window.addEventListener("resize", positionSelfView);
    return () => window.removeEventListener("resize", positionSelfView);
  }, []);

  useEffect(() => {
    const positionMinimizedCall = () => {
      const width = Math.min(320, Math.max(220, window.innerWidth * 0.75));
      const height = 144;
      setMinimizedPosition((position) => {
        const maxX = Math.max(8, window.innerWidth - width - 8);
        const maxY = Math.max(8, window.innerHeight - height - 8);
        return position
          ? { x: Math.min(position.x, maxX), y: Math.min(position.y, maxY) }
          : { x: maxX, y: maxY };
      });
    };
    positionMinimizedCall();
    window.addEventListener("resize", positionMinimizedCall);
    return () => window.removeEventListener("resize", positionMinimizedCall);
  }, []);

  const moveSelfView = (event) => {
    const card = event.currentTarget.closest("[data-self-view]");
    if (!card) return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    setSelfViewPosition({
      x: Math.min(Math.max(8, event.clientX - dragOffset.current.x), window.innerWidth - width - 8),
      y: Math.min(Math.max(8, event.clientY - dragOffset.current.y), window.innerHeight - height - 8),
    });
  };

  const dragOffset = useRef({ x: 0, y: 0 });
  const startSelfViewDrag = (event) => {
    const card = event.currentTarget.closest("[data-self-view]");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const startMinimizedDrag = (event) => {
    if (event.target.closest("button")) return;
    const card = event.currentTarget.closest("[data-minimized-call]");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveMinimizedCall = (event) => {
    const card = event.currentTarget.closest("[data-minimized-call]");
    if (!card) return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    setMinimizedPosition({
      x: Math.min(Math.max(8, event.clientX - dragOffset.current.x), window.innerWidth - width - 8),
      y: Math.min(Math.max(8, event.clientY - dragOffset.current.y), window.innerHeight - height - 8),
    });
  };

  useEffect(() => {
    const handleOffer = ({ offer, from, callType: incomingCallType }) => {
      if (currentTo.current && String(currentTo.current) !== String(from)) return;
      if (pc.current) return;
      const requestedType = incomingCallType === "audio" ? "audio" : "video";
      remoteUserId.current = from;
      setCallPeerName(currentPeerName.current);
      setIncomingOffer({ offer, from, callType: requestedType });
      setActiveCallType(requestedType);
      setMinimized(false);
      setVisible(true);
      setError("");
    };

    const handleAnswer = async ({ answer, from }) => {
      if (String(from) !== String(remoteUserId.current)) return;
      try {
        await pc.current?.setRemoteDescription(new RTCSessionDescription(answer));
        setCallStatus("Connecting");
        for (const candidate of pendingCandidates.current.splice(0)) {
          await pc.current?.addIceCandidate(new RTCIceCandidate(candidate));
        }
        setCalling(false);
      } catch (callError) {
        setError(callError.message || "Could not complete this call.");
      }
    };

    const handleCandidate = async ({ candidate, from }) => {
      if (String(from) !== String(remoteUserId.current)) return;
      if (!pc.current?.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }
      try {
        await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (callError) {
        setError(callError.message || "Could not connect the call network.");
      }
    };
    const handleHangup = ({ from }) => {
      if (String(from) !== String(remoteUserId.current)) return;
      cleanupCall();
      setIncomingOffer(null);
      setCalling(false);
      setCallStatus("Call ended");
      setMinimized(false);
      setVisible(false);
      onCloseRef.current?.();
    };

    Socket.on("offer", handleOffer);
    Socket.on("answer", handleAnswer);
    Socket.on("ice-candidate", handleCandidate);
    Socket.on("hangup", handleHangup);

    return () => {
      Socket.off("offer", handleOffer);
      Socket.off("answer", handleAnswer);
      Socket.off("ice-candidate", handleCandidate);
      Socket.off("hangup", handleHangup);
      cleanupCall();
    };
  }, []);

  const cleanupCall = () => {
    pc.current?.close();
    pc.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    remoteStream.current = null;
    setHasLocalMedia(false);
    setHasRemoteMedia(false);
    pendingCandidates.current = [];
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
  };

  const createPeerConnection = (targetId, mediaType) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        Socket.emit("ice-candidate", { candidate: event.candidate, to: targetId });
      }
    };

    peer.ontrack = (e) => {
      remoteStream.current = e.streams[0];
      setHasRemoteMedia(true);
      if (mediaType === "video" && remoteVideo.current) remoteVideo.current.srcObject = remoteStream.current;
      if (mediaType === "audio" && remoteAudio.current) remoteAudio.current.srcObject = remoteStream.current;
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setCalling(false);
      if (peer.connectionState === "connected") setCallStatus("Connected");
      if (peer.connectionState === "failed") {
        setCallStatus("Connection failed");
        setError("Call connection failed. Check your network and try again.");
      }
    };

    return peer;
  };

  const callUser = async () => {
    if (!to || calling || !Socket.connected) {
      setError("Connect to the chat server before starting a call.");
      return;
    }
    setCalling(true);
    setError("");
    setActiveCallType(callType);
    setCallPeerName(peerName);
    setMinimized(false);
    setCallStatus("Calling");
    remoteUserId.current = to;
    try {
      const stream = await ensureLocalMedia(callType);
      try {
        const { data: callRecord } = await axios.post(`${API_URL}/api/call-history`, {
          receiverId: to,
          callType,
        }, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
          withCredentials: true,
        });
        callHistoryId.current = callRecord._id;
      } catch (historyError) {
        console.error("Could not save call history:", historyError);
      }
      pc.current = createPeerConnection(to, callType);
      stream.getTracks().forEach((track) => pc.current.addTrack(track, stream));
      const offer = await pc.current.createOffer();
      await pc.current.setLocalDescription(offer);
      Socket.emit("offer", { offer, to, callType });
    } catch (callError) {
      setError(callError.message || "Could not start this call.");
      setCalling(false);
      setCallStatus("Ready to call");
    }
  };

  const acceptCall = async () => {
    if (!incomingOffer) return;
    try {
      const { offer, from, callType: incomingCallType } = incomingOffer;
      const stream = await ensureLocalMedia(incomingCallType);
      pc.current = createPeerConnection(from, incomingCallType);
      stream.getTracks().forEach((track) => pc.current.addTrack(track, stream));
      await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
      for (const candidate of pendingCandidates.current.splice(0)) {
        await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      const answer = await pc.current.createAnswer();
      await pc.current.setLocalDescription(answer);
      Socket.emit("answer", { answer, to: from });
      setIncomingOffer(null);
      setMinimized(false);
      setCalling(true);
      setCallStatus("Connecting");
      setError("");
    } catch (callError) {
      setError(callError.message || "Could not answer this call.");
    }
  };

  const closeCall = () => {
    if (remoteUserId.current && Socket.connected) {
      Socket.emit("hangup", { to: remoteUserId.current });
    }
    cleanupCall();
    if (callHistoryId.current) {
      axios.patch(`${API_URL}/api/call-history/${callHistoryId.current}`, { status: "completed" }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        withCredentials: true,
      }).catch((error) => console.error("Could not update call history:", error));
      callHistoryId.current = null;
    }
    setIncomingOffer(null);
    setCalling(false);
    setCallStatus("Call ended");
    setMinimized(false);
    setVisible(false);
    onCloseRef.current?.();
  };

  if (!visible && !incomingOffer) return null;

  return (
    <div
      data-minimized-call={minimized ? "true" : undefined}
      className={`fixed z-[100] overflow-hidden bg-[#071315] text-white ${minimized
        ? "h-36 w-[min(75vw,320px)] rounded-2xl border border-white/20 shadow-2xl"
        : "inset-0 w-screen"}`}
      style={minimized
        ? { left: minimizedPosition?.x ?? 8, top: minimizedPosition?.y ?? 8 }
        : { height: "var(--app-height, 100dvh)" }}
    >
      <section className="relative h-full w-full overflow-hidden" role="dialog" aria-modal={!minimized} aria-label={`${activeCallType} call`}>
        {activeCallType === "video" ? (
          <>
            <video
              ref={remoteVideo}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full bg-[#071315] object-cover"
            />
            {!hasRemoteMedia && !incomingOffer && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
                <div className="grid h-28 w-28 place-items-center rounded-full border border-white/15 bg-white/10 text-4xl font-light shadow-2xl ring-8 ring-white/5 sm:h-40 sm:w-40 sm:text-5xl">
                  {displayPeerName.slice(0, 1).toUpperCase()}
                </div>
                <p className="text-sm text-white/75">{callStatus === "Ready to call" ? "Ready when you are" : callStatus}</p>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-900/60 via-[#102426] to-[#050b0c]" />
        )}
        {!minimized && <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/70" />}

        {minimized ? (
          <header
            onPointerDown={startMinimizedDrag}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) moveMinimizedCall(event);
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            className="absolute inset-0 z-30 flex cursor-grab touch-none items-end justify-between gap-2 bg-black/75 p-2.5 backdrop-blur active:cursor-grabbing"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{displayPeerName}</p>
              <p className="truncate text-[10px] text-white/70">{callStatus}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setMinimized(false)} aria-label="Restore call" title="Restore call" className="grid h-8 w-8 place-items-center rounded-full bg-white/15 hover:bg-white/25">
                <FaExpand size={12} />
              </button>
              <button type="button" onClick={closeCall} aria-label="End call" title="End call" className="grid h-8 w-8 place-items-center rounded-full bg-rose-500 hover:bg-rose-400">
                <FaPhoneSlash size={12} />
              </button>
            </div>
          </header>
        ) : <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 pb-8 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold sm:text-lg">{displayPeerName}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-white/70 sm:text-sm">
              <span className={`h-2 w-2 rounded-full ${callStatus === "Connected" ? "bg-emerald-400" : "bg-amber-300"}`} />
              {incomingOffer ? `Incoming ${incomingOffer.callType} call` : callStatus}
            </p>
          </div>
          <div className="relative flex items-center gap-2">
            {!incomingOffer && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAudioRoutes((visibleRoutes) => !visibleRoutes)}
                  aria-label="Choose audio output"
                  aria-expanded={showAudioRoutes}
                  title="Choose audio output"
                  className="rounded-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white/90 backdrop-blur transition hover:bg-white/15"
                >
                  <FaVolumeUp />
                </button>
                {showAudioRoutes && (
                  <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-white/20 bg-[#071315]/95 p-2 shadow-2xl backdrop-blur">
                    {audioRoutes.length > 0 ? (
                      <>
                        <p className="px-2 py-1 text-xs text-white/60">Audio output</p>
                        <select
                          id="audio-route"
                          value={selectedAudioRoute}
                          onChange={changeAudioRoute}
                          className="w-full rounded-lg border border-white/20 bg-black/60 px-2 py-2 text-sm text-white"
                        >
                          {audioRoutes.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}
                        </select>
                      </>
                    ) : (
                      <p className="px-2 py-1 text-xs text-white/60">No selectable outputs detected.</p>
                    )}
                    {audioRouteError && <p className="px-2 py-1 text-xs text-rose-200">{audioRouteError}</p>}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setMinimized(true)}
              aria-label="Minimize call"
              className="rounded-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white/90 backdrop-blur transition hover:bg-white/15"
            >
              <FaWindowMinimize />
            </button>
            <button
              type="button"
              onClick={closeCall}
              aria-label="End call"
              className="rounded-full border border-white/20 bg-black/30 px-4 py-2 text-sm text-white/90 backdrop-blur transition hover:bg-white/15"
            >
              End
            </button>
          </div>
        </header>
        }

        {!minimized && activeCallType === "audio" && !incomingOffer && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
            <div className="grid h-36 w-36 place-items-center rounded-full border border-white/15 bg-white/10 text-5xl font-light shadow-2xl shadow-teal-950/40 ring-8 ring-white/5 sm:h-48 sm:w-48 sm:text-6xl">
              {displayPeerName.slice(0, 1).toUpperCase()}
            </div>
            <p className="text-sm text-white/70">Audio call</p>
          </div>
        )}
        {!minimized && activeCallType === "video" && hasLocalMedia && !incomingOffer && (
          <div
            data-self-view
            onPointerDown={startSelfViewDrag}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) moveSelfView(event);
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            className="absolute z-20 aspect-video touch-none cursor-grab overflow-hidden rounded-2xl border border-white/30 bg-black shadow-2xl shadow-black/50 ring-1 ring-black/20 active:cursor-grabbing"
            style={{
              width: "35vw",
              minWidth: 160,
              maxWidth: 420,
              left: selfViewPosition?.x ?? 16,
              top: selfViewPosition?.y ?? 80,
            }}
          >
            <video ref={localVideo} autoPlay muted playsInline className="pointer-events-none h-full w-full object-cover" />
            <span className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center bg-gradient-to-b from-black/60 to-transparent px-2 pb-3 pt-2 text-[10px] font-medium text-white/90 sm:text-xs">
              Your camera · drag to move
            </span>
          </div>
        )}

        {!minimized && incomingOffer && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 px-5 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-[#102426]/90 p-7 text-center shadow-2xl">
              <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full bg-teal-400/15 text-3xl font-semibold text-teal-100 ring-8 ring-teal-300/5">
                {displayPeerName.slice(0, 1).toUpperCase()}
              </div>
              <p className="text-xl font-semibold">{displayPeerName} is calling</p>
              <p className="mt-2 text-sm capitalize text-white/60">{incomingOffer.callType} call</p>
              {error && <p role="alert" className="mt-4 text-sm text-rose-200">{error}</p>}
              <div className="mt-8 flex justify-center gap-8">
                <button
                  type="button"
                  onClick={closeCall}
                  className="grid h-14 w-14 place-items-center rounded-full bg-rose-500 text-xl shadow-lg shadow-rose-950/40 transition hover:bg-rose-400"
                  aria-label="Decline call"
                  title="Decline"
                >
                  <FaPhoneSlash />
                </button>
                <button
                  type="button"
                  onClick={acceptCall}
                  className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-xl shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-400"
                  aria-label="Answer call"
                  title="Answer"
                >
                  <FaPhone />
                </button>
              </div>
            </div>
          </div>
        )}

        {!minimized && !incomingOffer && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16">
            {error && (
              <p role="alert" className="max-w-lg rounded-xl border border-rose-200/20 bg-rose-950/70 px-4 py-3 text-center text-sm text-rose-100 backdrop-blur">
                {error}
              </p>
            )}
            <div className="flex items-center gap-5 rounded-full border border-white/15 bg-black/45 px-5 py-4 shadow-2xl backdrop-blur-xl">
              {!calling && !["Connected", "Connecting", "Calling"].includes(callStatus) && (
                <button
                  type="button"
                  onClick={callUser}
                  disabled={!to}
                  className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Start call
                </button>
              )}
              {calling && <span className="px-2 text-sm text-white/80">Calling…</span>}
              <button
                type="button"
                onClick={closeCall}
                className="grid h-14 w-14 place-items-center rounded-full bg-rose-500 text-xl shadow-lg shadow-rose-950/40 transition hover:bg-rose-400"
                aria-label="End call"
                title="End call"
              >
                <FaPhoneSlash />
              </button>
            </div>
          </div>
        )}

        {activeCallType === "audio" && <audio ref={remoteAudio} autoPlay playsInline className="hidden" />}
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { FaExpand, FaPhone, FaPhoneSlash, FaUserPlus, FaVolumeUp, FaWindowMinimize } from "react-icons/fa";
import Socket from "../Socket";
import { listAudioRoutes, selectAudioRoute } from "../audioRouting";
import { readMediaDevicePreferences, saveMediaDevicePreferences } from "../mediaDevicePreferences";
import axios from "axios";
import FloatingPanel from "./FloatingPanel";
import useFloatingPanel from "../useFloatingPanel";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

export default function VideoCall({ to, peerName, callType, isOpen, onClose }) {
  const localVideo = useRef();
  const peerConnections = useRef(new Map());
  const remoteMediaElements = useRef(new Map());
  const localStream = useRef(null);
  const pendingCandidates = useRef(new Map());
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
  const [selfViewPosition, setSelfViewPosition] = useState(null);
  const [audioRoutes, setAudioRoutes] = useState([]);
  const [selectedAudioRoute, setSelectedAudioRoute] = useState("");
  const [audioRouteError, setAudioRouteError] = useState("");
  const [showAudioRoutes, setShowAudioRoutes] = useState(false);
  const [remotePeers, setRemotePeers] = useState([]);
  const [isCallHost, setIsCallHost] = useState(false);
  const [showInviteParticipant, setShowInviteParticipant] = useState(false);
  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [invitingParticipant, setInvitingParticipant] = useState(false);
  const audioRoutesPanel = useFloatingPanel(showAudioRoutes, () => setShowAudioRoutes(false));
  const callHistoryId = useRef(null);
  const callRoomId = useRef(null);
  const [minimizedPosition, setMinimizedPosition] = useState(null);

  currentPeerName.current = peerName;
  onCloseRef.current = onClose;
  const displayPeerName = callPeerName || peerName || "Private call";
  useEffect(() => setVisible(isOpen), [isOpen]);
  useEffect(() => {
    if (!peerConnections.current.size && !incomingOffer) setActiveCallType(callType);
  }, [callType, incomingOffer]);
  useEffect(() => {
    if (activeCallType === "video" && localVideo.current && localStream.current) localVideo.current.srcObject = localStream.current;
    for (const remotePeer of remotePeers) {
      const element = remoteMediaElements.current.get(remotePeer.userId);
      if (element && element.srcObject !== remotePeer.stream) element.srcObject = remotePeer.stream;
    }
  }, [activeCallType, hasLocalMedia, remotePeers, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    const loadRoutes = async () => {
      try {
        const routes = await listAudioRoutes();
        const preferredRouteId = readMediaDevicePreferences().audioOutputId;
        const preferredRoute = routes.find((route) => route.id === preferredRouteId);
        const availableSelectedRoute = routes.find((route) => route.id === selectedAudioRoute);
        const routeToUse = preferredRoute || availableSelectedRoute || routes[0];
        if (active) {
          setAudioRoutes(routes);
          if (routeToUse && selectedAudioRoute !== routeToUse.id) setSelectedAudioRoute(routeToUse.id);
        }
        const mediaElements = [...remoteMediaElements.current.values()];
        if (active && preferredRoute && mediaElements.length) {
          await selectAudioRoute(preferredRoute.id, mediaElements);
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
      await selectAudioRoute(routeId, [...remoteMediaElements.current.values()]);
      setSelectedAudioRoute(routeId);
      const currentPreferences = readMediaDevicePreferences();
      saveMediaDevicePreferences(undefined, { ...currentPreferences, audioOutputId: routeId });
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
      const devicePreferences = readMediaDevicePreferences();
      localStream.current = await mediaDevices.getUserMedia({
        video: mediaType === "video" ? {
          ...(devicePreferences.videoInputId ? { deviceId: { ideal: devicePreferences.videoInputId } } : {}),
        } : false,
        audio: devicePreferences.audioInputId
          ? { deviceId: { ideal: devicePreferences.audioInputId } }
          : true,
      });
    }
    setHasLocalMedia(true);
    if (mediaType === "video" && localVideo.current) localVideo.current.srcObject = localStream.current;
    return localStream.current;
  };

  useEffect(() => {
    const positionSelfView = () => {
      const width = Math.min(560, Math.max(220, window.innerWidth * 0.5));
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
    const handleOffer = ({ offer, from, fromName, roomId, callType: incomingCallType }) => {
      if (peerConnections.current.has(String(from)) || peerConnections.current.size > 0) return;
      const requestedType = incomingCallType === "audio" ? "audio" : "video";
      setCallPeerName(fromName || currentPeerName.current || "Caller");
      setIsCallHost(false);
      setIncomingOffer({ offer, from, fromName, roomId, callType: requestedType });
      setActiveCallType(requestedType);
      setMinimized(false);
      setVisible(true);
      setError("");
    };

    const handleAnswer = async ({ answer, from }) => {
      const peer = peerConnections.current.get(String(from));
      if (!peer || peer.remoteDescription) return;
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
        setCallStatus("Connecting");
        for (const candidate of pendingCandidates.current.get(String(from)) || []) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidates.current.delete(String(from));
        setCalling(false);
      } catch (callError) {
        setError(callError.message || "Could not complete this call.");
      }
    };

    const handleCandidate = async ({ candidate, from }) => {
      const peer = peerConnections.current.get(String(from));
      if (!peer?.remoteDescription) {
        const queue = pendingCandidates.current.get(String(from)) || [];
        queue.push(candidate);
        pendingCandidates.current.set(String(from), queue);
        return;
      }
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (callError) {
        setError(callError.message || "Could not connect the call network.");
      }
    };
    const handleHangup = ({ from }) => {
      const peerId = String(from);
      peerConnections.current.get(peerId)?.close();
      peerConnections.current.delete(peerId);
      pendingCandidates.current.delete(peerId);
      const remoteElement = remoteMediaElements.current.get(peerId);
      if (remoteElement) remoteElement.srcObject = null;
      remoteMediaElements.current.delete(peerId);
      setRemotePeers((current) => current.filter((peer) => peer.userId !== peerId));
      if (!peerConnections.current.size) {
        cleanupCall();
        setIncomingOffer(null);
        setCalling(false);
        setCallStatus("Call ended");
        setMinimized(false);
        setVisible(false);
        onCloseRef.current?.();
      }
    };
    const handleCallRoomError = ({ message }) => setError(message || "Could not add that participant to the call.");

    Socket.on("offer", handleOffer);
    Socket.on("answer", handleAnswer);
    Socket.on("ice-candidate", handleCandidate);
    Socket.on("hangup", handleHangup);
    Socket.on("call-room-error", handleCallRoomError);

    return () => {
      Socket.off("offer", handleOffer);
      Socket.off("answer", handleAnswer);
      Socket.off("ice-candidate", handleCandidate);
      Socket.off("hangup", handleHangup);
      Socket.off("call-room-error", handleCallRoomError);
      cleanupCall();
    };
  }, []);

  const cleanupCall = () => {
    peerConnections.current.forEach((peer) => peer.close());
    peerConnections.current.clear();
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    remoteMediaElements.current.forEach((element) => { element.srcObject = null; });
    remoteMediaElements.current.clear();
    setRemotePeers([]);
    setHasLocalMedia(false);
    setIsCallHost(false);
    pendingCandidates.current.clear();
    if (localVideo.current) localVideo.current.srcObject = null;
  };

  const createPeerConnection = (targetId) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        Socket.emit("ice-candidate", { candidate: event.candidate, to: targetId, roomId: callRoomId.current });
      }
    };

    peer.ontrack = (e) => {
      const stream = e.streams[0];
      setRemotePeers((current) => {
        const next = current.filter((item) => item.userId !== String(targetId));
        return [...next, { userId: String(targetId), name: peerNames.current.get(String(targetId)) || "Participant", stream }];
      });
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

  const peerNames = useRef(new Map());

  const createOutgoingPeer = async (targetId, targetName, stream, mediaType) => {
    const id = String(targetId);
    if (peerConnections.current.has(id)) return;
    peerNames.current.set(id, targetName || "Participant");
    const peer = createPeerConnection(id);
    peerConnections.current.set(id, peer);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    Socket.emit("offer", { offer, to: id, callType: mediaType, roomId: callRoomId.current });
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
    setIsCallHost(true);
    setMinimized(false);
    setCallStatus("Calling");
    callRoomId.current = crypto.randomUUID();
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
      await createOutgoingPeer(to, peerName || "Participant", stream, callType);
    } catch (callError) {
      setError(callError.message || "Could not start this call.");
      setCalling(false);
      setCallStatus("Ready to call");
    }
  };

  const acceptCall = async () => {
    if (!incomingOffer) return;
    const incomingId = String(incomingOffer.from);
    const existingPeer = peerConnections.current.get(incomingId);
    if (existingPeer && existingPeer.remoteDescription) return;
    try {
      const { offer, from, callType: incomingCallType } = incomingOffer;
      callRoomId.current = incomingOffer.roomId;
      const stream = await ensureLocalMedia(incomingCallType);
      const peer = existingPeer || createPeerConnection(from);
      if (!existingPeer) {
        peerConnections.current.set(incomingId, peer);
      }
      peerNames.current.set(incomingId, incomingOffer.fromName || callPeerName);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      for (const candidate of pendingCandidates.current.get(incomingId) || []) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidates.current.delete(incomingId);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      Socket.emit("answer", { answer, to: from, roomId: callRoomId.current });
      setIncomingOffer(null);
      setMinimized(false);
      setCalling(true);
      setCallStatus("Connecting");
      setError("");
    } catch (callError) {
      setError(callError.message || "Could not answer this call.");
    }
  };

  const inviteParticipant = async (event) => {
    event.preventDefault();
    const identifier = inviteIdentifier.trim();
    if (!identifier || !Socket.connected || !peerConnections.current.size) return;
    if (peerConnections.current.size >= 3) {
      setError("Small calls support up to four people, including you.");
      return;
    }
    setInvitingParticipant(true);
    setError("");
    try {
      const { data: participant } = await axios.post(`${API_URL}/api/call-invitees`, { identifier }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        withCredentials: true,
      });
      if (peerConnections.current.has(String(participant._id))) {
        setError("That person is already in this call.");
        return;
      }
      const stream = await ensureLocalMedia(activeCallType);
      await createOutgoingPeer(participant._id, participant.username, stream, activeCallType);
      setInviteIdentifier("");
      setCallPeerName((current) => current || participant.username);
      setCallStatus(`Calling ${participant.username}`);
    } catch (callError) {
      setError(callError.response?.data?.message || callError.message || "Could not invite that participant.");
    } finally {
      setInvitingParticipant(false);
    }
  };

  const closeCall = () => {
    if (Socket.connected) {
      peerConnections.current.forEach((_, participantId) => Socket.emit("hangup", { to: participantId, roomId: callRoomId.current }));
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
    callRoomId.current = null;
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
            {remotePeers.length > 0 ? remotePeers.map((remotePeer, index) => (
              <div key={remotePeer.userId} style={index > 0 ? { top: `${80 + (index - 1) * 148}px` } : undefined} className={index === 0 ? "absolute inset-0" : "absolute right-4 z-20 aspect-video w-[min(28vw,240px)] overflow-hidden rounded-xl border border-white/30 shadow-xl"}>
                <video
                  ref={(element) => {
                    if (element) {
                      element.srcObject = remotePeer.stream;
                      remoteMediaElements.current.set(remotePeer.userId, element);
                    } else remoteMediaElements.current.delete(remotePeer.userId);
                  }}
                  autoPlay
                  playsInline
                  className="h-full w-full bg-[#071315] object-cover"
                />
                <span className="absolute bottom-2 left-2 rounded bg-black/55 px-2 py-1 text-xs text-white">{remotePeer.name}</span>
              </div>
            )) : !incomingOffer && (
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
                <button type="button" onClick={() => setShowInviteParticipant((open) => !open)} disabled={!isCallHost || !peerConnections.current.size || peerConnections.current.size >= 3} aria-label="Invite participant" aria-expanded={showInviteParticipant} title={peerConnections.current.size >= 3 ? "Small calls are limited to four people" : "Invite participant"} className="rounded-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white/90 backdrop-blur transition hover:bg-white/15 disabled:opacity-40"><FaUserPlus /></button>
                {showInviteParticipant && <form onSubmit={inviteParticipant} className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-white/20 bg-[#071315]/95 p-3 shadow-2xl backdrop-blur"><p className="mb-2 text-xs text-white/70">Invite up to three guests to this call.</p><div className="flex gap-2"><input value={inviteIdentifier} onChange={(event) => setInviteIdentifier(event.target.value)} placeholder="Username or email" aria-label="Participant username or email" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white" /><button type="submit" disabled={invitingParticipant || !inviteIdentifier.trim()} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">{invitingParticipant ? "Inviting…" : "Invite"}</button></div>{remotePeers.length > 0 && <ul className="mt-2 space-y-1">{remotePeers.map((peer) => <li key={peer.userId} className="text-xs text-white/60">{peer.name} connected</li>)}</ul>}</form>}
              </div>
            )}
            {!incomingOffer && (
              <div className="relative">
                <button
                  type="button"
                  ref={audioRoutesPanel.triggerRef}
                  onClick={() => setShowAudioRoutes((visibleRoutes) => !visibleRoutes)}
                  aria-label="Choose audio output"
                  aria-expanded={showAudioRoutes}
                  title="Choose audio output"
                  className="rounded-full border border-white/20 bg-black/30 px-3 py-2 text-sm text-white/90 backdrop-blur transition hover:bg-white/15"
                >
                  <FaVolumeUp />
                </button>
                <FloatingPanel open={showAudioRoutes} panelRef={audioRoutesPanel.panelRef} style={audioRoutesPanel.style} className="w-56 rounded-xl border border-white/20 bg-[#071315]/95 p-2 shadow-2xl backdrop-blur">
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
                </FloatingPanel>
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
            <div className="flex flex-wrap justify-center gap-5">{remotePeers.map((remotePeer) => <div key={remotePeer.userId} className="flex flex-col items-center gap-2"><div className="grid h-28 w-28 place-items-center rounded-full border border-white/15 bg-white/10 text-4xl font-light shadow-2xl shadow-teal-950/40 ring-8 ring-white/5 sm:h-36 sm:w-36">{remotePeer.name.slice(0, 1).toUpperCase()}</div><span className="max-w-36 truncate text-sm text-white/80">{remotePeer.name}</span></div>)}</div>
            <p className="text-sm text-white/70">Audio call · {remotePeers.length + 1} participants</p>
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
              width: "50vw",
              minWidth: 220,
              maxWidth: 560,
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

        {activeCallType === "audio" && remotePeers.map((remotePeer) => <audio key={remotePeer.userId} ref={(element) => { if (element) { element.srcObject = remotePeer.stream; remoteMediaElements.current.set(remotePeer.userId, element); } else remoteMediaElements.current.delete(remotePeer.userId); }} autoPlay playsInline className="hidden" />)}
      </section>
    </div>
  );
}

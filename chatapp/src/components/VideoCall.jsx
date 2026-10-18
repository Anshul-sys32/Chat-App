import { useEffect, useRef, useState } from "react";
import Socket from "../Socket";

export default function VideoCall({ to, isOpen, onClose }) {
  const localVideo = useRef();
  const remoteVideo = useRef();
  const pc = useRef(null);
  const localStream = useRef(null);
  const pendingCandidates = useRef([]);
  const remoteUserId = useRef(null);
  const currentTo = useRef(to);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState("");
  const [calling, setCalling] = useState(false);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [visible, setVisible] = useState(isOpen);

  currentTo.current = to;
  onCloseRef.current = onClose;
  useEffect(() => setVisible(isOpen), [isOpen]);

  const ensureLocalMedia = async () => {
    if (!localStream.current) {
      localStream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    }
    if (localVideo.current) localVideo.current.srcObject = localStream.current;
    return localStream.current;
  };

  useEffect(() => {
    const handleOffer = ({ offer, from }) => {
      if (currentTo.current && String(currentTo.current) !== String(from)) return;
      if (pc.current) return;
      remoteUserId.current = from;
      setIncomingOffer({ offer, from });
      setVisible(true);
      setError("");
    };

    const handleAnswer = async ({ answer, from }) => {
      if (String(from) !== String(remoteUserId.current)) return;
      try {
        await pc.current?.setRemoteDescription(new RTCSessionDescription(answer));
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
    pendingCandidates.current = [];
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
  };

  const createPeerConnection = (targetId) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        Socket.emit("ice-candidate", { candidate: event.candidate, to: targetId });
      }
    };

    peer.ontrack = (e) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = e.streams[0];
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setCalling(false);
      if (peer.connectionState === "failed") setError("Call connection failed. Check your network and try again.");
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
    remoteUserId.current = to;
    try {
      const stream = await ensureLocalMedia();
      pc.current = createPeerConnection(to);
      stream.getTracks().forEach((track) => pc.current.addTrack(track, stream));
      const offer = await pc.current.createOffer();
      await pc.current.setLocalDescription(offer);
      Socket.emit("offer", { offer, to });
    } catch (callError) {
      setError(callError.message || "Could not start this call.");
      setCalling(false);
    }
  };

  const acceptCall = async () => {
    if (!incomingOffer) return;
    try {
      const { offer, from } = incomingOffer;
      const stream = await ensureLocalMedia();
      pc.current = createPeerConnection(from);
      stream.getTracks().forEach((track) => pc.current.addTrack(track, stream));
      await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
      for (const candidate of pendingCandidates.current.splice(0)) {
        await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      const answer = await pc.current.createAnswer();
      await pc.current.setLocalDescription(answer);
      Socket.emit("answer", { answer, to: from });
      setIncomingOffer(null);
      setCalling(true);
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
    setIncomingOffer(null);
    setCalling(false);
    setVisible(false);
    onCloseRef.current?.();
  };

  if (!visible && !incomingOffer) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <section className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white p-5 text-gray-900 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{incomingOffer ? "Incoming video call" : "Video call"}</h2>
          <button type="button" onClick={closeCall} className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" aria-label="Close call">Close</button>
        </div>
        {incomingOffer ? (
          <div className="flex items-center justify-between gap-4 rounded-lg bg-teal-50 p-4">
            <p className="text-sm text-gray-700">A contact is calling you.</p>
            <div className="flex gap-2">
              <button type="button" onClick={closeCall} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">Decline</button>
              <button type="button" onClick={acceptCall} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Answer</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <video ref={localVideo} autoPlay muted playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />
              <video ref={remoteVideo} autoPlay playsInline className="aspect-video w-full rounded-lg bg-black object-cover" />
            </div>
            {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
            <div className="flex justify-between">
              <button type="button" onClick={callUser} disabled={!to || calling} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">{calling ? "Calling..." : "Start call"}</button>
              <button type="button" onClick={closeCall} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">End call</button>
            </div>
          </>
        )}
        {error && incomingOffer && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </section>
    </div>
  );
}

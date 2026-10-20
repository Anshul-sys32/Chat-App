import { useEffect, useState } from "react";
import axios from "axios";
import { FaPhone, FaPhoneSlash, FaTrash } from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
  withCredentials: true,
});

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
};

export default function CallHistory({ onStartChat }) {
  const [calls, setCalls] = useState([]);
  const [error, setError] = useState("");

  const loadCalls = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/call-history`, authConfig());
      setCalls(Array.isArray(data) ? data : []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load call history.");
    }
  };

  useEffect(() => { loadCalls(); }, []);

  const deleteCall = async (callId) => {
    try {
      await axios.delete(`${API_URL}/api/call-history/${callId}`, authConfig());
      setCalls((previous) => previous.filter((call) => String(call._id) !== String(callId)));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not delete this call.");
    }
  };

  const clearHistory = async () => {
    if (!window.confirm("Clear your entire call history?")) return;
    try {
      await axios.delete(`${API_URL}/api/call-history`, authConfig());
      setCalls([]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not clear call history.");
    }
  };

  return (
    <div className="text-white">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Call History</h3>
        {calls.length > 0 && (
          <button type="button" onClick={clearHistory} className="text-xs text-rose-200 hover:text-rose-100">
            Clear all
          </button>
        )}
      </div>
      {error && <p role="alert" className="mb-2 text-xs text-rose-200">{error}</p>}
      {calls.length === 0 ? (
        <p className="text-sm text-gray-400">No calls yet.</p>
      ) : (
        <ul className="space-y-2">
          {calls.map((call) => (
            <li key={call._id} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.045] px-3 py-2">
              <span className={call.direction === "outgoing" ? "text-emerald-300" : "text-sky-300"} title={`${call.direction} ${call.callType} call`}>
                {call.status === "declined" || call.status === "missed" ? <FaPhoneSlash /> : <FaPhone />}
              </span>
              <button type="button" onClick={() => onStartChat?.({ _id: call.peerId, username: call.peerName })} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium">{call.peerName}</span>
                <span className="block truncate text-xs text-gray-400">{call.callType} · {formatDate(call.startedAt)}</span>
              </button>
              <button type="button" onClick={() => deleteCall(call._id)} aria-label={`Delete call with ${call.peerName}`} className="p-2 text-gray-400 hover:text-rose-200">
                <FaTrash size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

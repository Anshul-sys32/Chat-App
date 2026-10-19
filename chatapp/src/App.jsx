import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Routes, Route, Navigate } from "react-router-dom";
import Chat from "./components/Chat";
import UserForm from "./components/UserForm";
import AdminPanel from "./components/AdminPanel";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";

const readSelectedChat = () => {
  try {
    return JSON.parse(localStorage.getItem("selectedChat") || "null");
  } catch {
    localStorage.removeItem("selectedChat");
    return null;
  }
};

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      return localStorage.getItem("token")
        ? JSON.parse(localStorage.getItem("user"))
        : null;
    } catch {
      localStorage.removeItem("user");
      localStorage.removeItem("token");
      return null;
    }
  });
  const [selectedChat, setSelectedChat] = useState(readSelectedChat);

  const verifySession = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const { data } = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        withCredentials: true,
        timeout: 10000,
      });
      if (localStorage.getItem("token") !== token) return;
      setUser(data.user);
      localStorage.setItem("user", JSON.stringify(data.user));
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        if (localStorage.getItem("token") !== token) return;
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        setUser(null);
      } else {
        console.warn("Session verification unavailable; keeping the saved session and retrying when online.");
      }
    }
  }, []);

  useEffect(() => {
    const revalidateWhenAvailable = () => {
      if (document.visibilityState === "visible" && navigator.onLine) verifySession();
    };
    verifySession();
    window.addEventListener("online", revalidateWhenAvailable);
    document.addEventListener("visibilitychange", revalidateWhenAvailable);
    return () => {
      window.removeEventListener("online", revalidateWhenAvailable);
      document.removeEventListener("visibilitychange", revalidateWhenAvailable);
    };
  }, [verifySession]);

  useEffect(() => {
    if (selectedChat) localStorage.setItem("selectedChat", JSON.stringify(selectedChat));
    else localStorage.removeItem("selectedChat");
  }, [selectedChat]);

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/chat" replace /> : <UserForm onAuthenticated={setUser} />} />
      <Route
        path="/admin"
        element={user?.role === "admin" ? <AdminPanel user={user} /> : <Navigate to={user ? "/chat" : "/login"} replace />}
      />
      <Route
        path="/chat"
        element={user ? (
          <Chat user={user} selectedChat={selectedChat} onSelectChat={setSelectedChat} />
        ) : <Navigate to="/login" replace />}
      />
      <Route
        path="*"
        element={<Navigate to={user ? "/chat" : "/login"} replace />}
      />
    </Routes>
  );
}

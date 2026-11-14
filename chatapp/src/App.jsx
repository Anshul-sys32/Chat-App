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
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("theme");
    return savedTheme === "light" ? "light" : "dark";
  });
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
  const updateTheme = () => {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      localStorage.setItem("theme", nextTheme);
      return nextTheme;
    });
  };
  const updateUser = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem("user", JSON.stringify(updatedUser));
  };

  const verifySession = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const { data } = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        withCredentials: true,
        timeout: 10000,
      });
      if (localStorage.getItem("token") !== token) return;
      const verifiedUser = { ...data.user, _id: data.user._id ?? data.user.id };
      setUser(verifiedUser);
      localStorage.setItem("user", JSON.stringify(verifiedUser));
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
    const syncSessionAcrossTabs = (event) => {
      if (event.key !== "token" && event.key !== "user") return;
      if (!localStorage.getItem("token")) {
        setUser(null);
        return;
      }
      verifySession();
    };
    verifySession();
    window.addEventListener("online", revalidateWhenAvailable);
    document.addEventListener("visibilitychange", revalidateWhenAvailable);
    window.addEventListener("storage", syncSessionAcrossTabs);
    return () => {
      window.removeEventListener("online", revalidateWhenAvailable);
      document.removeEventListener("visibilitychange", revalidateWhenAvailable);
      window.removeEventListener("storage", syncSessionAcrossTabs);
    };
  }, [verifySession]);

  useEffect(() => {
    if (selectedChat) localStorage.setItem("selectedChat", JSON.stringify(selectedChat));
    else localStorage.removeItem("selectedChat");
  }, [selectedChat]);

  return (
    <div className="app-theme min-h-screen" data-theme={theme}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/chat" replace /> : <UserForm onAuthenticated={setUser} />} />
        <Route
          path="/admin"
          element={user?.role === "admin" ? <AdminPanel user={user} onUserUpdated={updateUser} /> : <Navigate to={user ? "/chat" : "/login"} replace />}
        />
        <Route
          path="/chat"
          element={user ? (
            <Chat
              user={user}
              selectedChat={selectedChat}
              onSelectChat={setSelectedChat}
              onUserUpdated={updateUser}
              theme={theme}
              onToggleTheme={updateTheme}
            />
          ) : <Navigate to="/login" replace />}
        />
        <Route
          path="*"
          element={<Navigate to={user ? "/chat" : "/login"} replace />}
        />
      </Routes>
    </div>
  );
}

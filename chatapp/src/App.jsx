import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Chat from "./components/Chat";
import UserForm from "./components/UserForm";

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
  const [selectedChat, setSelectedChat] = useState(null);

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/chat" replace /> : <UserForm onAuthenticated={setUser} />} />
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

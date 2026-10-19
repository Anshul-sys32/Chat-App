// socket.js
import { io } from "socket.io-client";

const Socket = io(import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_SERVER_URL, {
  transports: ["websocket", "polling"],
  withCredentials: true,
  autoConnect: false,
});

export const connectAndRegisterUser = (token) => {
  if (!token) {
    Socket.auth = {};
    if (Socket.connected) Socket.disconnect();
    return;
  }
  if (Socket.auth?.token && Socket.auth.token !== token && Socket.connected) {
    Socket.disconnect();
  }
  Socket.auth = { token };
  if (!Socket.connected) Socket.connect();
};

export default Socket;

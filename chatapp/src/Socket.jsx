// socket.js
import { io } from "socket.io-client";

const Socket = io(import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_SERVER_URL, {
  transports: ["websocket", "polling"],
  withCredentials: true,
  autoConnect: false,
});

export const connectAndRegisterUser = (token) => {
  if (!token) return;
  Socket.auth = { token };
  if (!Socket.connected) Socket.connect();
};

export default Socket;

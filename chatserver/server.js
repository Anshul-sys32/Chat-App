require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { connectDB } = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const { corsOrigin } = require("./utils/cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Warn if CLIENT_URL is missing
if (!process.env.CLIENT_URL) {
  console.warn("⚠️ Warning: CLIENT_URL is not set in .env. Using default http://localhost:5173");
}

// Initialize SQL tables before accepting requests.
connectDB().then(() => {
  server.listen(PORT, "0.0.0.0", () =>
    console.log(`✅ Server running on http://0.0.0.0:${PORT}`)
  );
}).catch((err) => {
  console.error("❌ MySQL connection failed:", err.message);
  process.exit(1);
});

// Middleware
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// Routes
app.use("/api", authRoutes);

// ✅ Initialize Socket.IO (moved inside socket.js)
const initSocket = require("./sockets/socket");
app.set("io", initSocket(server));

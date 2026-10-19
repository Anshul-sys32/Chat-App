require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("node:path");
const fs = require("node:fs");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { connectDB } = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const { corsOrigin } = require("./utils/cors");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5175;
const HOST = process.env.HOST || "::";
const frontendDist = path.resolve(__dirname, "../chatapp/dist");

// Initialize SQL tables before accepting requests.
connectDB().then(() => {
  server.listen(PORT, HOST, () =>
    console.log(`✅ Server running on http://${HOST.includes(":") ? `[${HOST}]` : HOST}:${PORT}`)
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

if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (
      req.method !== "GET"
      || req.path === "/api"
      || req.path.startsWith("/api/")
      || req.path === "/socket.io"
      || req.path.startsWith("/socket.io/")
      || !req.accepts("html")
    ) {
      return next();
    }
    return res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  console.warn("Frontend build not found. Run `npm run build` in chatapp to serve the web app from this server.");
}

const initSocket = require("./sockets/socket");
app.set("io", initSocket(server));

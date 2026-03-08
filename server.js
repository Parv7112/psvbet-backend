import "dotenv/config";
import express from "express";
import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth.js";
import meetingRoutes from "./routes/meeting.js";
import clientRoutes from "./routes/client.js";
import cricketRoutes from "./routes/cricket.js";

const app = express();
const server = http.createServer(app);

// Define allowed origins first
const allowedOrigins = [
  'http://localhost:3000',
  'https://psvbet-frontend.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

function isAllowedOrigin(origin) {
  // In local/dev, allow all origins so multiple devices (LAN IPs) can connect.
  if (process.env.NODE_ENV !== "production") return true;

  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  const extra = (process.env.ADDITIONAL_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;

  // Allow Vercel preview deployments (common source of “works locally, breaks deployed”)
  if (origin.endsWith(".vercel.app")) return true;

  return false;
}

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (isAllowedOrigin(origin)) return callback(null, true);
    console.log('Blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error:", err));

// Routes
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "PSVBet Backend API",
    allowedOrigins: allowedOrigins
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/meeting", meetingRoutes);
app.use("/api/client", clientRoutes);
app.use("/api/cricket", cricketRoutes);

// ICE config for WebRTC (STUN/TURN)
app.get("/api/ice", (req, res) => {
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];

  const turnUrls = process.env.TURN_URLS || process.env.TURN_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrls && turnUsername && turnCredential) {
    const urls = turnUrls
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (urls.length) {
      iceServers.push({
        urls: urls.length === 1 ? urls[0] : urls,
        username: turnUsername,
        credential: turnCredential
      });
    }
  }

  res.json({ iceServers });
});

let latestOdds = null;

// async function fetchOdds() {
//   try {
//     const response = await axios.get(
//       "https://api.the-odds-api.com/v4/sports/cricket/odds",
//       {
//         params: {
//           apiKey: "5dfd4e1176e26a76bebc517302c2649e",
//           regions: "uk",
//           markets: "h2h",
//           oddsFormat: "decimal",
//         },
//       }
//     );

//     const matches = response.data.map((match) => {
//       const bookmaker = match.bookmakers?.[0];
//       const market = bookmaker?.markets?.find(
//         (m) => m.key === "h2h"
//       );

//       return {
//         teamA: match.home_team,
//         teamB: match.away_team,
//         odds: market?.outcomes?.map((o) => ({
//           name: o.name,
//           price: o.price,
//         })),
//         bookmaker: bookmaker?.title || "Unknown",
//       };
//     });

//     latestOdds = { matches };

//     io.emit("odds_update", latestOdds);

//     console.log("Odds updated:", matches.length);

//   } catch (err) {
//     console.log("Status:", err.response?.status);
//     console.log("Error:", err.response?.data || err.message);
//   }
// }

// Fetch every 10 seconds (free tier friendly)
// setInterval(fetchOdds, 10000);

// -------------------------
// WebSocket realtime server
// -------------------------
const wss = new WebSocketServer({ server, path: "/ws" });

const wsById = new Map();      // id -> ws
const metaById = new Map();    // id -> {id, roomId, userName, userId, isHost}
const roomMembers = new Map(); // roomId -> Set<id>

function wsSend(ws, msg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

function broadcastRoom(roomId, msg, excludeId = null) {
  const members = roomMembers.get(roomId);
  if (!members) return;
  for (const id of members) {
    if (excludeId && id === excludeId) continue;
    const ws = wsById.get(id);
    if (ws && ws.readyState === 1) wsSend(ws, msg);
  }
}

function removeFromRoom(id) {
  const meta = metaById.get(id);
  if (!meta?.roomId) return;
  const roomId = meta.roomId;
  const members = roomMembers.get(roomId);
  if (members) {
    members.delete(id);
    if (members.size === 0) roomMembers.delete(roomId);
  }
  meta.roomId = null;
  metaById.set(id, meta);
  broadcastRoom(roomId, { type: "user-left", id }, id);
}

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    try { ws.close(1008, "Origin not allowed"); } catch {}
    return;
  }

  const id = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

  wsById.set(id, ws);
  metaById.set(id, { id, roomId: null, userName: null, userId: null, isHost: false });
  wsSend(ws, { type: "ws-hello", id });

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    const meta = metaById.get(id);
    if (!meta) return;

    const { type, requestId } = msg || {};

    if (type === "join-meeting") {
      const { roomId, userName, userId } = msg || {};
      if (!roomId || !userName) {
        wsSend(ws, { type: "ack", requestId, ok: false, message: "Missing roomId/userName" });
        return;
      }

      removeFromRoom(id);

      let isHost = false;
      try {
        const Meeting = (await import("./models/Meeting.js")).default;
        const meeting = await Meeting.findOne({ roomId });
        if (meeting && userId && meeting.hostId.toString() === String(userId)) {
          isHost = true;
        }
      } catch {
        // ignore
      }

      meta.roomId = roomId;
      meta.userName = userName;
      meta.userId = userId || null;
      meta.isHost = isHost;
      metaById.set(id, meta);

      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
      roomMembers.get(roomId).add(id);

      const members = Array.from(roomMembers.get(roomId))
        .map(mid => metaById.get(mid))
        .filter(Boolean);
      const host = members.find(m => m.isHost);

      if (isHost) {
        const others = members.filter(m => m.id !== id);
        wsSend(ws, { type: "join-state", users: others.map(u => ({ id: u.id, userName: u.userName, isHost: u.isHost })) });
        broadcastRoom(roomId, { type: "user-joined", id, userName, isHost: true }, id);
      } else {
        if (host) {
          wsSend(ws, { type: "user-joined", id: host.id, userName: host.userName, isHost: true });
          const hostWs = wsById.get(host.id);
          if (hostWs && hostWs.readyState === 1) {
            wsSend(hostWs, { type: "user-joined", id, userName, isHost: false });
          }
        }
      }

      wsSend(ws, { type: "ack", requestId, ok: true, id, roomId, isHost });
      return;
    }

    if (type === "leave-meeting") {
      removeFromRoom(id);
      wsSend(ws, { type: "ack", requestId, ok: true });
      return;
    }

    if (type === "signal") {
      const { to, data } = msg || {};
      if (!meta.roomId || !to || !data) return;
      const toWs = wsById.get(to);
      const toMeta = metaById.get(to);
      if (!toWs || toWs.readyState !== 1) return;
      if (!toMeta || toMeta.roomId !== meta.roomId) return;
      wsSend(toWs, { type: "signal", from: id, data });
      return;
    }

    if (type === "share-odds") {
      if (!meta.roomId) return;
      broadcastRoom(meta.roomId, { type: "odds-update", ...msg }, null);
      return;
    }

    if (type === "start-private-call") {
      const { targetId, fromUserName } = msg || {};
      if (!meta.roomId || !targetId) return;
      const tWs = wsById.get(targetId);
      const tMeta = metaById.get(targetId);
      if (!tWs || tWs.readyState !== 1) return;
      if (!tMeta || tMeta.roomId !== meta.roomId) return;
      wsSend(tWs, { type: "private-call-request", fromId: id, fromUserName: fromUserName || meta.userName });
      return;
    }

    if (type === "end-private-call") {
      const { targetId } = msg || {};
      if (!meta.roomId || !targetId) return;
      const tWs = wsById.get(targetId);
      const tMeta = metaById.get(targetId);
      if (!tWs || tWs.readyState !== 1) return;
      if (!tMeta || tMeta.roomId !== meta.roomId) return;
      wsSend(tWs, { type: "private-call-ended" });
      return;
    }
  });

  ws.on("close", () => {
    removeFromRoom(id);
    wsById.delete(id);
    metaById.delete(id);
  });
});

server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
  console.log("WebSocket server available at /ws");
});
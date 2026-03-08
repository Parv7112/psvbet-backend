import "dotenv/config";
import express from "express";
import http from "http";
import axios from "axios";
import { Server } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import authRoutes from "./routes/auth.js";
import meetingRoutes from "./routes/meeting.js";
import clientRoutes from "./routes/client.js";
import cricketRoutes from "./routes/cricket.js";
import { ExpressPeerServer } from "peer";

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

const io = new Server(server, {
  cors: { 
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
  pingInterval: 25000
});

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

// PeerJS Server (mount AFTER CORS middleware)
const peerServer = ExpressPeerServer(server, {
  debug: true,
  path: '/',
  proxied: true
});
app.use('/peerjs', peerServer);

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

// Store active meetings and participants
const meetings = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  
  if (latestOdds) {
    socket.emit("odds_update", latestOdds);
  }

  socket.on("join-meeting", async (data) => {
    const { roomId, userName, peerId, userId } = data;
    
    console.log(`[JOIN] ${userName} (peer: ${peerId}) joining room ${roomId}, userId: ${userId}`);
    
    if (!meetings.has(roomId)) {
      meetings.set(roomId, []);
    }
    
    const usersInRoom = meetings.get(roomId);
    
    // Remove any old entries for this user (handles reconnections)
    let removedOldPeer = false;
    if (userId) {
      const oldUserIndex = usersInRoom.findIndex(u => u.userId === userId);
      if (oldUserIndex !== -1) {
        console.log(`[JOIN] Removing old entry for user ${userName}`);
        const oldUser = usersInRoom.splice(oldUserIndex, 1)[0];
        removedOldPeer = true;
        // Notify others that old peer left
        socket.to(roomId).emit("user-left", oldUser.peerId);
      }
    }
    
    // Small delay if we removed an old peer to ensure cleanup completes
    if (removedOldPeer) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Check if this user is the host
    let isHost = false;
    try {
      const Meeting = (await import('./models/Meeting.js')).default;
      const meeting = await Meeting.findOne({ roomId });
      console.log(`[JOIN] Meeting hostId: ${meeting?.hostId}, userId: ${userId}`);
      
      if (meeting && userId && meeting.hostId.toString() === userId.toString()) {
        isHost = true;
        console.log(`[JOIN] ${userName} is the HOST`);
      } else {
        console.log(`[JOIN] ${userName} is a PARTICIPANT`);
      }
    } catch (err) {
      console.log("Error checking host:", err);
    }
    
    // Add new user
    const newUser = { socketId: socket.id, peerId, userName, isHost, userId };
    usersInRoom.push(newUser);
    socket.join(roomId);
    
    // Find the host in the room
    const host = usersInRoom.find(u => u.isHost);
    
    if (isHost) {
      // If joining user is host, send them all participants (excluding themselves)
      const otherUsers = usersInRoom.filter(user => user.peerId !== peerId);
      otherUsers.forEach(user => {
        socket.emit("user-joined", { 
          peerId: user.peerId, 
          userName: user.userName,
          isHost: user.isHost 
        });
      });
      
      // Notify all participants that host joined
      socket.to(roomId).emit("user-joined", { 
        peerId, 
        userName,
        isHost: true 
      });
    } else {
      // If joining user is participant
      // Send them only the host
      if (host && host.peerId !== peerId) {
        socket.emit("user-joined", { 
          peerId: host.peerId, 
          userName: host.userName,
          isHost: true 
        });
      }
      
      // Notify only the host about new participant
      if (host) {
        io.to(host.socketId).emit("user-joined", { 
          peerId, 
          userName,
          isHost: false 
        });
      }
    }
    
    console.log(`[JOIN] ${userName} (${isHost ? 'HOST' : 'PARTICIPANT'}) joined. Total: ${usersInRoom.length}`);
  });

  socket.on("leave-meeting", (data) => {
    const { roomId } = data;
    handleUserLeave(socket.id, roomId);
  });

  socket.on("start-private-call", (data) => {
    const { roomId, targetPeerId, fromPeerId, fromUserName } = data;
    console.log(`[PRIVATE] ${fromUserName} starting private call with ${targetPeerId}`);
    
    // Find the target user's socket
    const usersInRoom = meetings.get(roomId) || [];
    const targetUser = usersInRoom.find(u => u.peerId === targetPeerId);
    
    if (targetUser) {
      io.to(targetUser.socketId).emit("private-call-request", {
        fromPeerId,
        fromUserName
      });
    }
  });

  socket.on("end-private-call", (data) => {
    const { roomId, targetPeerId } = data;
    console.log(`[PRIVATE] Ending private call with ${targetPeerId}`);
    
    // Find the target user's socket
    const usersInRoom = meetings.get(roomId) || [];
    const targetUser = usersInRoom.find(u => u.peerId === targetPeerId);
    
    if (targetUser) {
      io.to(targetUser.socketId).emit("private-call-ended");
    }
  });

  socket.on("share-odds", (data) => {
    const { roomId } = data;
    console.log(`[ODDS] Sharing odds in room ${roomId}`, data);
    console.log(`[ODDS] Broadcasting to room ${roomId}`);
    
    // Broadcast odds to all users in the room (including sender for confirmation)
    io.to(roomId).emit("odds-update", data);
    
    console.log(`[ODDS] Odds broadcasted successfully`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    meetings.forEach((users, roomId) => {
      handleUserLeave(socket.id, roomId);
    });
  });
});

function handleUserLeave(socketId, roomId) {
  if (meetings.has(roomId)) {
    const users = meetings.get(roomId);
    const index = users.findIndex(u => u.socketId === socketId);
    
    if (index !== -1) {
      const leftUser = users.splice(index, 1)[0];
      io.to(roomId).emit("user-left", leftUser.peerId);
      console.log(`[LEAVE] ${leftUser.userName} left. Remaining: ${users.length}`);
      
      if (users.length === 0) {
        meetings.delete(roomId);
      }
    }
  }
}

server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
  console.log(`PeerJS server running on port ${process.env.PORT || 5000}/peerjs`);
});
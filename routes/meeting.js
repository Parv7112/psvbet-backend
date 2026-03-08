import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import Meeting from "../models/Meeting.js";
import crypto from "crypto";
import multer from "multer";
import fs from "fs";
import path from "path";

const router = express.Router();

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

const recordingUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const roomId = req.params.roomId;
      const dir = path.join(process.cwd(), "uploads", "meetings", roomId);
      ensureDirSync(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const safeExt = (file.originalname || "").split(".").pop()?.toLowerCase();
      const ext = safeExt && safeExt.length <= 6 ? `.${safeExt}` : "";
      const prefix = file.fieldname === "audio" ? "audio" : "recording";
      cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
    }
  }),
  limits: {
    fileSize: 1024 * 1024 * 500 // 500MB
  }
});

router.post("/create", authMiddleware, async (req, res) => {
  try {
    const { title, selectedMatch } = req.body;
    const roomId = crypto.randomBytes(8).toString("hex");
    
    const meeting = new Meeting({
      roomId,
      hostId: req.userId,
      hostName: req.body.hostName,
      title: title || "Untitled Meeting",
      selectedMatch: selectedMatch || null
    });

    await meeting.save();

    res.json({
      roomId,
      joinUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/meeting/${roomId}`
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to create meeting" });
  }
});

router.get("/user/my-meetings", authMiddleware, async (req, res) => {
  try {
    const meetings = await Meeting.find({ hostId: req.userId })
      .sort({ createdAt: -1 })
      .limit(20);
    
    res.json(meetings);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:roomId", async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });
    
    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    res.json(meeting);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:roomId/toggle-status", authMiddleware, async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });
    
    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }

    // Check if user is the host
    if (meeting.hostId.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    meeting.isActive = !meeting.isActive;
    await meeting.save();

    res.json(meeting);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:roomId/recordings", authMiddleware, async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });

    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    if (meeting.hostId.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    res.json({ recordings: meeting.recordings || [] });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/:roomId/recordings",
  authMiddleware,
  recordingUpload.fields([
    { name: "recording", maxCount: 1 },
    { name: "audio", maxCount: 1 }
  ]),
  async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });

    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    if (meeting.hostId.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const recordingFile = req.files?.recording?.[0];
    const audioFile = req.files?.audio?.[0];

    if (!recordingFile) {
      return res.status(400).json({ message: "Missing recording file" });
    }

    const relativePath = path.posix.join(
      "meetings",
      req.params.roomId,
      recordingFile.filename
    );
    const audioRelativePath = audioFile
      ? path.posix.join("meetings", req.params.roomId, audioFile.filename)
      : null;

    const byName = req.body.byName || meeting.hostName || "Host";

    meeting.recordings = meeting.recordings || [];
    meeting.recordings.push({
      byUserId: req.userId,
      byName,
      filename: recordingFile.filename,
      relativePath,
      mimeType: recordingFile.mimetype,
      sizeBytes: recordingFile.size,
      audioFilename: audioFile?.filename,
      audioRelativePath: audioRelativePath || undefined,
      audioMimeType: audioFile?.mimetype,
      audioSizeBytes: audioFile?.size
    });

    await meeting.save();

    const recording = meeting.recordings[meeting.recordings.length - 1];
    res.json({
      recording: {
        ...recording.toObject?.() ?? recording,
        url: `/uploads/${relativePath}`,
        audioUrl: audioRelativePath ? `/uploads/${audioRelativePath}` : null
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to upload recording" });
  }
});

router.post("/:roomId/recordings/:recordingId/transcribe", authMiddleware, async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });

    if (!meeting) return res.status(404).json({ message: "Meeting not found" });
    if (meeting.hostId.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const rec = (meeting.recordings || []).id(req.params.recordingId);
    if (!rec) return res.status(404).json({ message: "Recording not found" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ message: "OPENAI_API_KEY is not set on the server" });
    }

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";

    const relForTranscription = rec.audioRelativePath || rec.relativePath;
    const absPath = path.join(process.cwd(), "uploads", relForTranscription);

    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ message: "Recording file missing on server" });
    }

    // OpenAI transcriptions have a file-size limit (commonly ~25MB).
    const stat = fs.statSync(absPath);
    const maxBytes = 25 * 1024 * 1024;
    if (stat.size > maxBytes) {
      return res.status(400).json({
        message: `Audio file too large for transcription (${Math.round(stat.size / (1024 * 1024))}MB). Please record shorter segments.`
      });
    }

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(absPath),
      model
    });

    rec.transcript = {
      provider: "openai",
      model,
      text: transcription.text || "",
      createdAt: new Date()
    };

    await meeting.save();

    res.json({ transcript: rec.transcript });
  } catch (error) {
    console.error("Transcription failed:", error);
    const message =
      error?.error?.message ||
      error?.message ||
      "Transcription failed";
    const status =
      error?.status ||
      error?.response?.status ||
      (error?.code === "insufficient_quota" ? 402 : undefined) ||
      500;
    res.status(status).json({ message });
  }
});

export default router;

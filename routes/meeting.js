import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import Meeting from "../models/Meeting.js";
import crypto from "crypto";

const router = express.Router();

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

export default router;

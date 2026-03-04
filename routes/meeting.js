import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import Meeting from "../models/Meeting.js";
import crypto from "crypto";

const router = express.Router();

router.post("/create", authMiddleware, async (req, res) => {
  try {
    const { title } = req.body;
    const roomId = crypto.randomBytes(8).toString("hex");
    
    const meeting = new Meeting({
      roomId,
      hostId: req.userId,
      hostName: req.body.hostName,
      title: title || "Untitled Meeting"
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

export default router;

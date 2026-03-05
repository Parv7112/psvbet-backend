import mongoose from "mongoose";

const meetingSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  hostName: String,
  title: String,
  selectedMatch: {
    matchId: String,
    matchName: String,
    league: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  participants: [{
    userId: String,
    name: String,
    joinedAt: Date
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Meeting", meetingSchema);

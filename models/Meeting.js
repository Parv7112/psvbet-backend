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
  recordings: [{
    createdAt: {
      type: Date,
      default: Date.now
    },
    byUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    byName: String,
    filename: String,
    relativePath: String,
    mimeType: String,
    sizeBytes: Number,
    audioFilename: String,
    audioRelativePath: String,
    audioMimeType: String,
    audioSizeBytes: Number,
    transcript: {
      provider: String,
      model: String,
      text: String,
      createdAt: Date
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("Meeting", meetingSchema);

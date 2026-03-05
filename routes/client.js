import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import Client from "../models/Client.js";
import crypto from "crypto";

const router = express.Router();

// Generate client ID and password
function generateClientId(name, number) {
  const namePrefix = name.substring(0, 3).toUpperCase();
  const numberSuffix = number.substring(number.length - 4);
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${namePrefix}${numberSuffix}${random}`;
}

function generatePassword(name, number) {
  const namePart = name.substring(0, 4).toLowerCase();
  const numberPart = number.substring(number.length - 4);
  const random = crypto.randomBytes(2).toString('hex');
  return `${namePart}${numberPart}${random}`;
}

// Create client
router.post("/create", authMiddleware, async (req, res) => {
  try {
    const { name, number } = req.body;

    if (!name || !number) {
      return res.status(400).json({ message: "Name and number are required" });
    }

    const clientId = generateClientId(name, number);
    const password = generatePassword(name, number);

    const client = new Client({
      clientId,
      name,
      number,
      password,
      createdBy: req.userId
    });

    await client.save();

    res.status(201).json(client);
  } catch (error) {
    console.error("Create client error:", error);
    res.status(500).json({ message: "Failed to create client" });
  }
});

// Get all clients for logged-in user
router.get("/my-clients", authMiddleware, async (req, res) => {
  try {
    const clients = await Client.find({ createdBy: req.userId })
      .sort({ createdAt: -1 });
    
    res.json(clients);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update client
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { name, number } = req.body;
    
    const client = await Client.findById(req.params.id);
    
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    if (client.createdBy.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    client.name = name || client.name;
    client.number = number || client.number;

    await client.save();

    res.json(client);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Delete client
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    if (client.createdBy.toString() !== req.userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await Client.findByIdAndDelete(req.params.id);

    res.json({ message: "Client deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Verify client credentials
router.post("/verify", async (req, res) => {
  try {
    const { clientId, password } = req.body;

    if (!clientId || !password) {
      return res.status(400).json({ message: "Client ID and password are required" });
    }

    const client = await Client.findOne({ clientId, password });

    if (!client) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.json({ 
      success: true, 
      client: {
        id: client._id,
        clientId: client.clientId,
        name: client.name
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;

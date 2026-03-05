import express from "express";

const router = express.Router();

// Get current cricket matches (live + upcoming)
router.get("/current-matches", async (req, res) => {
  try {
    const apiKey = process.env.CRICKET_API_KEY;
    
    if (!apiKey || apiKey === 'your_cricket_api_key_here') {
      return res.json({
        success: 0,
        result: [],
        info: {
          message: "Please add your CRICKET_API_KEY to the .env file. Get your free 14-day trial from https://www.api-cricket.com/"
        }
      });
    }

    // Get today's date and next 7 days
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    const dateStart = today.toISOString().split('T')[0];
    const dateStop = nextWeek.toISOString().split('T')[0];

    // Fetch live matches and upcoming matches
    const [liveResponse, eventsResponse] = await Promise.all([
      fetch(`https://apiv2.api-cricket.com/cricket/?method=get_livescore&APIkey=${apiKey}`),
      fetch(`https://apiv2.api-cricket.com/cricket/?method=get_events&APIkey=${apiKey}&date_start=${dateStart}&date_stop=${dateStop}`)
    ]);

    const liveData = await liveResponse.json();
    const eventsData = await eventsResponse.json();

    if (!liveResponse.ok || !eventsResponse.ok) {
      console.error("Cricket API Error:", { liveData, eventsData });
      throw new Error("Failed to fetch cricket matches");
    }

    // Combine live and upcoming matches
    const liveMatches = liveData.result || [];
    const upcomingMatches = eventsData.result || [];
    
    // Remove duplicates (live matches might also be in events)
    const allMatches = [...liveMatches];
    const liveKeys = new Set(liveMatches.map(m => m.event_key));
    
    upcomingMatches.forEach(match => {
      if (!liveKeys.has(match.event_key)) {
        allMatches.push(match);
      }
    });

    console.log(`✅ Cricket API: Fetched ${liveMatches.length} live + ${upcomingMatches.length} upcoming matches`);

    res.json({
      success: 1,
      result: allMatches,
      info: {
        live: liveMatches.length,
        upcoming: upcomingMatches.length,
        total: allMatches.length
      }
    });
  } catch (error) {
    console.error("Cricket API error:", error);
    res.status(500).json({ 
      success: 0,
      message: "Failed to fetch cricket matches",
      error: error.message,
      result: []
    });
  }
});

// Get match details by ID
router.get("/match/:id", async (req, res) => {
  try {
    const apiKey = process.env.CRICKET_API_KEY;
    
    if (!apiKey || apiKey === 'your_cricket_api_key_here') {
      return res.status(400).json({
        success: 0,
        message: "Please add your CRICKET_API_KEY to the .env file"
      });
    }

    const response = await fetch(`https://apiv2.api-cricket.com/cricket/?method=get_events&APIkey=${apiKey}&event_key=${req.params.id}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch match details");
    }

    res.json(data);
  } catch (error) {
    console.error("Cricket API error:", error);
    res.status(500).json({ 
      success: 0,
      message: "Failed to fetch match details",
      error: error.message 
    });
  }
});

// Get all leagues
router.get("/leagues", async (req, res) => {
  try {
    const apiKey = process.env.CRICKET_API_KEY;
    
    if (!apiKey || apiKey === 'your_cricket_api_key_here') {
      return res.status(400).json({
        success: 0,
        message: "Please add your CRICKET_API_KEY to the .env file"
      });
    }

    const response = await fetch(`https://apiv2.api-cricket.com/cricket/?method=get_leagues&APIkey=${apiKey}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch leagues");
    }

    res.json(data);
  } catch (error) {
    console.error("Cricket API error:", error);
    res.status(500).json({ 
      success: 0,
      message: "Failed to fetch leagues",
      error: error.message 
    });
  }
});

export default router;

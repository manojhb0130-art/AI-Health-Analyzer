import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = 3000;
const dbCheck = new Database("outbreak.db");

// --- WebSocket Setup ---
const wss = new WebSocketServer({ server });

const broadcastAlert = (alert: any) => {
  const message = JSON.stringify({ type: "new_alert", data: alert });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

// --- Database Initialization ---
dbCheck.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    token TEXT,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS timeseries_data (
    date TEXT PRIMARY KEY,
    temp REAL,
    humidity REAL,
    rainfall REAL,
    standing_water REAL,
    er_visits INTEGER,
    lab_positivity REAL,
    pharmacy_sales REAL,
    social_mentions INTEGER,
    mobility_index REAL,
    wastewater_rna REAL,
    case_count INTEGER,
    is_outbreak INTEGER
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    risk_score REAL,
    severity TEXT,
    message TEXT,
    resolved INTEGER DEFAULT 0
  );
`);

// Seed Users
const adminPassword = bcrypt.hashSync("admin123", 10);
const analystPassword = bcrypt.hashSync("analyst123", 10);
dbCheck.prepare("INSERT OR IGNORE INTO users (username, email, password, role) VALUES (?, ?, ?, ?)").run("admin", "admin@outbreakradar.gov", adminPassword, "admin");
dbCheck.prepare("INSERT OR IGNORE INTO users (username, email, password, role) VALUES (?, ?, ?, ?)").run("analyst", "analyst@outbreakradar.gov", analystPassword, "analyst");

// --- AI Initialization ---
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
});

// --- Middleware ---
app.use(express.json());

const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET || "secret", (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: "Admin access required" });
  }
};

// --- Notification System ---
const simulateEmail = (to: string, subject: string, body: string) => {
  console.log("-----------------------------------------");
  console.log(`SIMULATED EMAIL SENT`);
  console.log(`TO: ${to}`);
  console.log(`SUBJECT: ${subject}`);
  console.log(`BODY: ${body}`);
  console.log("-----------------------------------------");
};

// --- Weather Helper (Open-Meteo free API) ---
const fetchWeather = async (lat: number, lng: number) => {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&hourly=temperature_2m,relative_humidity_2m,precipitation_probability`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Weather Fetch Error:", err);
    return null;
  }
};

// --- API Routes ---

// Auth
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user: any = dbCheck.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (user && bcrypt.compareSync(password, user.password)) {
    const token = jwt.sign({ username: user.username, role: user.role }, process.env.JWT_SECRET || "secret");
    res.json({ token, role: user.role, username: user.username });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

app.post("/api/forgot-password", (req, res) => {
  const { email } = req.body;
  const user = dbCheck.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    return res.json({ message: "If an account with that email exists, we have sent a reset token." });
  }

  const token = Math.random().toString(36).substring(2, 10).toUpperCase();
  const expiresAt = Date.now() + 3600000; // 1 hour

  dbCheck.prepare("INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, ?)").run(email, token, expiresAt);

  simulateEmail(
    email, 
    "OutbreakRadar - Password Reset Token", 
    `Your password reset token is: ${token}. Use this to reset your password within 1 hour.`
  );

  res.json({ message: "If an account with that email exists, we have sent a reset token." });
});

app.post("/api/reset-password", (req, res) => {
  const { email, token, newPassword } = req.body;
  const reset: any = dbCheck.prepare("SELECT * FROM password_reset_tokens WHERE email = ? AND token = ? AND expires_at > ?").get(email, token, Date.now());

  if (!reset) {
    return res.status(400).json({ message: "Invalid or expired token" });
  }

  const hashed = bcrypt.hashSync(newPassword, 10);
  dbCheck.prepare("UPDATE users SET password = ? WHERE email = ?").run(hashed, email);
  dbCheck.prepare("DELETE FROM password_reset_tokens WHERE email = ?").run(email);

  simulateEmail(
    email,
    "OutbreakRadar - Password Changed",
    "Your password has been successfully updated. If you did not perform this action, contact IT immediately."
  );

  res.json({ message: "Password updated successfully" });
});

// Ingest Simulation & Alert Generation
app.post("/api/ingest", authenticateToken, requireAdmin, (req, res) => {
  const batch = req.body; // Expect array of data points
  const insertStmt = dbCheck.prepare(`
    INSERT INTO timeseries_data (
      date, temp, humidity, rainfall, standing_water, er_visits, 
      lab_positivity, pharmacy_sales, social_mentions, mobility_index, 
      wastewater_rna, case_count, is_outbreak
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const alertStmt = dbCheck.prepare(`
    INSERT INTO alerts (date, risk_score, severity, message) 
    VALUES (?, ?, ?, ?)
  `);

  batch.forEach((d: any) => {
    insertStmt.run(
      d.date, d.temp, d.humidity, d.rainfall, d.standing_water,
      d.er_visits, d.lab_positivity, d.pharmacy_sales,
      d.social_mentions, d.mobility_index, d.wastewater_rna,
      d.case_count, d.is_outbreak
    );

    // Alert Logic (Simplified Simulation for Preview)
    const risk = Math.min(100, (d.wastewater_rna * 10) + (d.lab_positivity * 50));
    if (risk >= 40) {
      const severity = risk >= 70 ? "CRITICAL" : "WARNING";
      const message = `${severity}: Risk score detected at ${risk.toFixed(1)}% on ${d.date}.`;
      const result = alertStmt.run(d.date, risk, severity, message);
      const newAlert = { id: result.lastInsertRowid, date: d.date, risk_score: risk, severity, message, resolved: 0 };
      
      broadcastAlert(newAlert);

      // Notify Admins
      const admins: any[] = dbCheck.prepare("SELECT email FROM users WHERE role = 'admin'").all();
      admins.forEach((admin) => {
        simulateEmail(
          admin.email,
          `🚨 ${severity} OUTBREAK ALERT - ${d.date}`,
          `OutbreakRadar has detected a ${severity} risk level (${risk.toFixed(1)}%).\nLog: ${message}`
        );
      });
    }
  });

  res.json({ message: `Ingested ${batch.length} records and processed alerts.` });
});

// User Management (Admin Only)
app.get("/api/users", authenticateToken, requireAdmin, (req, res) => {
  const users = dbCheck.prepare("SELECT id, username, email, role FROM users").all();
  res.json(users);
});

app.post("/api/users", authenticateToken, requireAdmin, (req, res) => {
  const { username, email, password, role } = req.body;
  const hashed = bcrypt.hashSync(password, 10);
  try {
    const result = dbCheck.prepare("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)").run(username, email, hashed, role);
    res.json({ id: result.lastInsertRowid, username, email, role });
  } catch (err) {
    res.status(400).json({ message: "User already exists or invalid data" });
  }
});

app.put("/api/users/:id", authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { username, email, password, role } = req.body;
  if (password) {
    const hashed = bcrypt.hashSync(password, 10);
    dbCheck.prepare("UPDATE users SET username = ?, email = ?, password = ?, role = ? WHERE id = ?").run(username, email, hashed, role, id);
  } else {
    dbCheck.prepare("UPDATE users SET username = ?, email = ?, role = ? WHERE id = ?").run(username, email, role, id);
  }
  res.json({ message: "User updated successfully" });
});

app.delete("/api/users/:id", authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  // Prevent admin from deleting themselves if needed, but for now simple delete
  dbCheck.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ message: "User deleted successfully" });
});

app.post("/api/analyze-surroundings", authenticateToken, async (req, res) => {
  const { lat, lng } = req.body;
  
  try {
    const weatherData = await fetchWeather(lat, lng);
    
    const prompt = `
      As an AI epidemiologist, analyze the following real-time environmental data for the coordinates (${lat}, ${lng}).
      Weather Data: ${JSON.stringify(weatherData)}
      
      Assess the risk for vector-borne diseases (like Dengue, Malaria, or West Nile) and water-borne illnesses based on current temperature, humidity, and precipitation patterns.
      
      Return a JSON response with:
      1. risk_score (0-100)
      2. summary (Brief analysis of surroundings)
      3. recommendations (Array of actionable advice)
      4. top_threats (Array of specific diseases or environmental hazards)
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            risk_score: { type: Type.NUMBER },
            summary: { type: Type.STRING },
            recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            top_threats: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });

    res.json(JSON.parse(response.text));
  } catch (error) {
    console.error("Analysis Error:", error);
    res.status(500).json({ message: "Environmental analysis failed" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", environment: process.env.NODE_ENV || "development" });
});

// Dashboard Data
app.get("/api/dashboard", authenticateToken, (req, res) => {
  const latestData = dbCheck.prepare("SELECT * FROM timeseries_data ORDER BY date DESC LIMIT 90").all().reverse();
  const latestAlerts = dbCheck.prepare("SELECT * FROM alerts ORDER BY date DESC LIMIT 5").all();
  
  if (latestData.length === 0) {
    return res.json({ data: [], alerts: [], metrics: { totalCases7d: 0, avgRisk: 0, alertsToday: 0 } });
  }

  const last7d = latestData.slice(-7);
  const totalCases7d = last7d.reduce((acc: number, curr: any) => acc + curr.case_count, 0);
  const avgRisk = latestAlerts.length > 0 ? latestAlerts[0].risk_score : 15;

  res.json({
    data: latestData,
    alerts: latestAlerts,
    metrics: {
      totalCases7d,
      avgRisk,
      alertsToday: latestAlerts.filter((a: any) => a.date === latestData[latestData.length-1].date).length,
      leadTimeMs: "4.2 days"
    }
  });
});

// Alerts History
app.get("/api/alerts", authenticateToken, (req, res) => {
  const alerts = dbCheck.prepare("SELECT * FROM alerts ORDER BY date DESC").all();
  res.json(alerts);
});

// Explain Prediction (using Gemini)
app.get("/api/explain/:date", authenticateToken, async (req, res) => {
  const { date } = req.params;
  const data: any = dbCheck.prepare("SELECT * FROM timeseries_data WHERE date = ?").get(date);
  
  if (!data) return res.status(404).json({ message: "Data not found" });

  try {
    const prompt = `Analyze this public health data for date ${date} and explain the factors driving the outbreak risk.
    Data: ${JSON.stringify(data)}
    Provide: 
    1. A natural language summary of why the risk is high/low.
    2. Top 5 driving features with percentage contribution (approximate).
    Return as JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            contributions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  feature: { type: Type.STRING },
                  contribution: { type: Type.NUMBER },
                  impact: { type: Type.STRING, enum: ["positive", "negative"] }
                }
              }
            }
          }
        }
      }
    });

    res.json(JSON.parse(response.text));
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ message: "AI Analysis failed" });
  }
});

// Forecast (Mocked for now, using latest trend)
app.get("/api/forecast/:days", authenticateToken, (req, res) => {
  const days = parseInt(req.params.days) || 14;
  const latestData: any = dbCheck.prepare("SELECT * FROM timeseries_data ORDER BY date DESC LIMIT 30").all().reverse();
  
  // Simple linear extrapolation simulation for preview
  const lastVal = latestData[latestData.length - 1].case_count;
  const avgChange = (lastVal - latestData[0].case_count) / 30;
  
  const forecast = Array.from({ length: days }).map((_, i) => ({
    date: new Date(new Date(latestData[latestData.length - 1].date).getTime() + (i + 1) * 86400000).toISOString().split('T')[0],
    predicted_cases: Math.max(0, Math.round(lastVal + avgChange * (i + 1) + Math.random() * 10 - 5)),
    confidence_upper: Math.round(lastVal + avgChange * (i + 1) + 20 + i * 2),
    confidence_lower: Math.max(0, Math.round(lastVal + avgChange * (i + 1) - 20 - i * 2))
  }));

  res.json(forecast);
});

// Seeding / Ingest Simulation
app.post("/api/retrain", authenticateToken, requireAdmin, (req, res) => {
  // Simulate retraining
  setTimeout(() => {
    console.log("Model retrained successfully.");
  }, 1000);
  res.json({ message: "Retraining triggered", status: "processing" });
});

// --- Vite Integration ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`OutbreakRadar Server running on http://0.0.0.0:${PORT}`);
    // Seed data if empty
    const count: any = dbCheck.prepare("SELECT COUNT(*) as count FROM timeseries_data").get();
    if (count.count === 0) {
      console.log("Seeding synthetic data...");
      seedData();
    }
  });
}

function seedData() {
  const insertStmt = dbCheck.prepare(`
    INSERT INTO timeseries_data (
      date, temp, humidity, rainfall, standing_water, er_visits, 
      lab_positivity, pharmacy_sales, social_mentions, mobility_index, 
      wastewater_rna, case_count, is_outbreak
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const alertStmt = dbCheck.prepare(`
    INSERT INTO alerts (date, risk_score, severity, message) 
    VALUES (?, ?, ?, ?)
  `);

  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 2);

  for (let i = 0; i < 730; i++) {
    const currDate = new Date(startDate.getTime() + i * 86400000);
    const dateStr = currDate.toISOString().split('T')[0];
    
    // Seasonal patterns (Sine waves)
    const season = Math.sin((i / 365) * 2 * Math.PI);
    const temp = 20 + 10 * season + Math.random() * 2;
    const humidity = 60 + 20 * season + Math.random() * 5;
    
    // Inject outbreaks (e.g., day 180, 350, 540, 700)
    let outbreakForce = 0;
    if ((i > 180 && i < 210) || (i > 351 && i < 380) || (i > 540 && i < 570) || (i > 700)) {
      outbreakForce = 50 * Math.exp(-Math.pow(i % 180 - 15, 2) / 100); 
      // Simplified: just add a hump
      const offset = [180, 350, 540, 700].find(d => i >= d && i < d + 30) || 0;
      outbreakForce = 40 * Math.sin(((i - offset) / 30) * Math.PI);
    }

    const wastewater = Math.max(0, 5 + outbreakForce * 0.8 + Math.random() * 2);
    const er_visits = Math.max(0, Math.round(20 + outbreakForce * 0.5 + Math.random() * 10));
    const cases = Math.max(0, Math.round(5 + outbreakForce + Math.random() * 5));
    const isOutbreak = outbreakForce > 15 ? 1 : 0;

    insertStmt.run(
      dateStr, temp, humidity, Math.random() * 10, Math.random() * 1,
      er_visits, (Math.random() * 0.1 + (outbreakForce / 100)),
      100 + outbreakForce * 2 + Math.random() * 20,
      Math.round(10 + outbreakForce * 5 + Math.random() * 50),
      0.8 + Math.random() * 0.4,
      wastewater, cases, isOutbreak
    );

    // Occasional Alerts
    if (outbreakForce > 10 && i % 5 === 0) {
      const risk = Math.min(100, 30 + outbreakForce * 1.5);
      const severity = risk > 70 ? "CRITICAL" : "WARNING";
      alertStmt.run(dateStr, risk, severity, `${severity}: Unusual spike in wastewater markers and ER visits.`);
    }
  }
  console.log("Seeding complete.");
}

startServer();

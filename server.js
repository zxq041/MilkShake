// server.js — MINIMAL (rezerwacje + happybar realtime)

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// ==========================
//  MongoDB
// ==========================
const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) console.error("❌ Brak MONGO_URL w zmiennych środowiskowych!");

mongoose
  .connect(MONGO_URL, { dbName: "milkshakebar", autoIndex: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("MongoDB connect error:", err));

// ==========================
//  Kolekcje (NOWE)
// ==========================
const COL_PREFIX = "new_";
const col = (name) => `${COL_PREFIX}${name}`;

// ==========================
//  Modele
// ==========================
const ReservationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  guests: { type: String, required: true },
  room: { type: String, required: true },
  notes: { type: String, default: "" },

  // opcjonalne pola (jak masz w index/admin)
  email: { type: String, default: "" },
  milkId: { type: String, default: "" },
  source: { type: String, default: "index" },

  createdAt: { type: Date, default: Date.now },
});

const HappySchema = new mongoose.Schema({
  text: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

const Reservation = mongoose.model("Reservation", ReservationSchema, col("reservations"));
const HappyBar = mongoose.model("HappyBar", HappySchema, col("happybars"));

// ==========================
//  Express config
// ==========================
app.use(cors());
app.options("*", cors());

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// ==========================
//  Socket.IO
// ==========================
io.on("connection", (socket) => {
  // nic nie musisz robić – emitujemy globalnie eventy
  socket.on("disconnect", () => {});
});

// ==========================
//  API — Happy bar (pasek u góry)
// ==========================

// strona/index/admin może pobrać aktualny tekst
app.get("/api/happy", async (_req, res) => {
  try {
    const doc = await HappyBar.findOne().sort({ updatedAt: -1 });
    res.json({ ok: true, happy: doc?.text || "" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, happy: "" });
  }
});

// admin ustawia tekst + realtime na stronę
app.post("/api/happy", async (req, res) => {
  try {
    const text = String(req.body?.happy ?? req.body?.text ?? "");
    await HappyBar.create({ text, updatedAt: new Date() });

    io.emit("happy-updated", text);
    res.json({ ok: true, happy: text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu paska" });
  }
});

// ==========================
//  API — Rezerwacje
// ==========================

// admin ładuje listę (np. przy starcie)
app.get("/api/rezerwacje", async (_req, res) => {
  try {
    const list = await Reservation.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// index.html wysyła rezerwację -> zapis do Mongo + realtime do admin
app.post("/api/rezerwacje", async (req, res) => {
  try {
    const r = req.body || {};

    if (!r.name || !r.phone || !r.date || !r.time || !r.guests || !r.room) {
      return res.status(400).json({ ok: false, message: "Uzupełnij wszystkie wymagane pola." });
    }

    const reservation = await Reservation.create({
      name: String(r.name),
      phone: String(r.phone),
      date: String(r.date),
      time: String(r.time),
      guests: String(r.guests),
      room: String(r.room),
      notes: String(r.notes || ""),
      email: String(r.email || ""),
      milkId: String(r.milkId || ""),
      source: String(r.source || "index"),
    });

    io.emit("new-reservation", reservation);
    res.json({ ok: true, reservation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu rezerwacji" });
  }
});

// ==========================
//  Proste healthcheck
// ==========================
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mongoState: mongoose.connection.readyState, // 1 = connected
    db: mongoose.connection.name,
  });
});

// ==========================
//  Clean URL routes (opcjonalnie)
// ==========================
app.get("/admin", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/index.html", (_req, res) => res.redirect(301, "/"));

// SPA fallback (nie łamiemy /api i /socket.io)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, message: "Not found" });
  if (req.path.startsWith("/socket.io/")) return res.sendStatus(404);
  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

server.listen(PORT, () => console.log("✅ MilkShake Bar (minimal) running on port:", PORT));

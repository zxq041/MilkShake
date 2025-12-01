// server.js — MilkShake Bar backend (Express + Socket.IO + db.json)

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ==========================
//  BASIC CONFIG
// ==========================
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_PATH = path.join(__dirname, "db.json");

// json + forms
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// static files
app.use(express.static(PUBLIC_DIR));

// uploads folder
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

// ==========================
//  DB (file-backed)
// ==========================
function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const init = { products: [], reservations: [], happy: "" };
      fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2), "utf-8");
      return init;
    }
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    return {
      products: parsed.products || [],
      reservations: parsed.reservations || [],
      happy: parsed.happy || ""
    };
  } catch (e) {
    console.error("DB load error:", e);
    return { products: [], reservations: [], happy: "" };
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  } catch (e) {
    console.error("DB save error:", e);
  }
}

// helper id
const makeId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ==========================
//  SOCKET.IO
// ==========================
io.on("connection", (socket) => {
  // możesz logować jeśli chcesz:
  // console.log("Socket connected:", socket.id);

  socket.on("disconnect", () => {
    // console.log("Socket disconnected:", socket.id);
  });
});

// ==========================
//  MULTER (IMAGE UPLOAD)
// ==========================
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safeName =
      Date.now() + "-" + file.originalname.replace(/[^\w.-]/g, "_");
    cb(null, safeName);
  }
});
const upload = multer({ storage });

// upload endpoint (dla produktów)
app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "Brak pliku" });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

// ==========================
//  API: DATA (produkty + happy + rezerwacje)
// ==========================

// cały db (wykorzystuje index.html do menu i happy bar)
app.get("/api/data", (req, res) => {
  res.json(db);
});

// opcjonalny patch (fallback z admina)
app.patch("/api/data", (req, res) => {
  try {
    const { products, happy } = req.body || {};
    if (Array.isArray(products)) db.products = products;
    if (typeof happy !== "undefined") db.happy = String(happy || "");
    saveDB();

    if (typeof happy !== "undefined") {
      io.emit("happy-updated", db.happy);
    }

    res.json({ ok: true, db });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd aktualizacji danych" });
  }
});

// ==========================
//  API: PRODUCTS
// ==========================
app.get("/api/produkty", (req, res) => {
  res.json(db.products);
});

app.post("/api/produkty", (req, res) => {
  try {
    const p = req.body || {};
    const product = {
      id: makeId(),
      title: p.title || p.name || "Produkt",
      desc: p.desc || p.description || "",
      price: p.price ?? "",
      image: p.image || "",
      createdAt: Date.now()
    };
    db.products.push(product);
    saveDB();
    io.emit("products-updated", db.products);
    res.json({ ok: true, product });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd dodawania produktu" });
  }
});

app.put("/api/produkty/:id", (req, res) => {
  try {
    const id = req.params.id;
    const idx = db.products.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ ok:false, message:"Nie znaleziono produktu" });

    db.products[idx] = { ...db.products[idx], ...req.body };
    saveDB();
    io.emit("products-updated", db.products);
    res.json({ ok:true, product: db.products[idx] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Błąd edycji produktu" });
  }
});

app.delete("/api/produkty/:id", (req, res) => {
  try {
    const id = req.params.id;
    db.products = db.products.filter(p => p.id !== id);
    saveDB();
    io.emit("products-updated", db.products);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Błąd usuwania produktu" });
  }
});

// ==========================
//  API: RESERVATIONS
// ==========================

// lista rezerwacji (admin panel)
app.get("/api/rezerwacje", (req, res) => {
  res.json(db.reservations || []);
});

// dodawanie rezerwacji (formularz na stronie głównej)
app.post("/api/rezerwacje", (req, res) => {
  try {
    const r = req.body || {};
    if (!r.name || !r.phone || !r.date || !r.time || !r.guests || !r.room) {
      return res.status(400).json({ ok:false, message:"Uzupełnij wszystkie wymagane pola." });
    }

    const reservation = {
      id: makeId(),
      name: String(r.name),
      phone: String(r.phone),
      date: String(r.date),
      time: String(r.time),
      guests: String(r.guests),
      room: String(r.room),
      notes: String(r.notes || ""),
      createdAt: Date.now()
    };

    db.reservations.push(reservation);
    saveDB();

    // realtime do admina
    io.emit("new-reservation", reservation);

    res.json({ ok:true, reservation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Błąd zapisu rezerwacji" });
  }
});

// opcjonalnie: usuwanie rezerwacji
app.delete("/api/rezerwacje/:id", (req, res) => {
  try {
    const id = req.params.id;
    db.reservations = db.reservations.filter(x => x.id !== id);
    saveDB();
    io.emit("reservations-updated", db.reservations);
    res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Błąd usuwania rezerwacji" });
  }
});

// ==========================
//  API: HAPPY BAR (PASEK INFORMACJI)
// ==========================
app.post("/api/happy", (req, res) => {
  try {
    const { happy } = req.body || {};
    db.happy = String(happy || "");
    saveDB();

    // realtime na stronę główną
    io.emit("happy-updated", db.happy);

    res.json({ ok:true, happy: db.happy });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, message:"Błąd zapisu paska informacji" });
  }
});

// ==========================
//  ROUTES: ADMIN WITHOUT .html
// ==========================
app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

// (opcjonalnie) krótki alias do menu pod /menu
app.get("/menu", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "menu.html"));
});

// ==========================
//  FALLBACK (SPA-ish)
// ==========================
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ==========================
//  START
// ==========================
server.listen(PORT, () => {
  console.log("MilkShake Bar server running on port:", PORT);
});

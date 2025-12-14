// server.js — MilkShake Bar backend (Express + Socket.IO + MongoDB)
// Pliki statyczne (index.html, admin.html, app.html, appadmin.html, menu.html) są w ROOT repo (bez folderów).

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// ==========================
//  MONGODB CONNECT
// ==========================
const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
  console.error("❌ Brak MONGO_URL w zmiennych środowiskowych!");
}

mongoose
  .connect(MONGO_URL, { dbName: "milkshakebar" })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("MongoDB connect error:", err));

// ==========================
//  MODELS
// ==========================

// Produkty na stronie/menu
const ProductSchema = new mongoose.Schema({
  title: { type: String, required: true },
  desc: { type: String, default: "" },
  price: { type: String, default: "" },
  image: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

// Rezerwacje (index.html i app.html powinny walić do /api/rezerwacje)
const ReservationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  guests: { type: String, required: true },
  room: { type: String, required: true },
  notes: { type: String, default: "" },
  source: { type: String, default: "web" }, // "web" / "pwa"
  createdAt: { type: Date, default: Date.now },
});

// Pasek info (happy bar)
const HappySchema = new mongoose.Schema({
  text: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

// Pracownicy do login PIN (manager/employee)
const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  pin: { type: String, required: true, unique: true }, // 4 cyfry
  role: { type: String, enum: ["manager", "employee"], default: "employee" },
  createdAt: { type: Date, default: Date.now },
});

// === PWA / APLIKACJA: użytkownicy, historia, kody, zamówienia ===

// Użytkownik aplikacji (Milk ID = 6 cyfr)
const AppUserSchema = new mongoose.Schema({
  milkId: { type: String, required: true, unique: true }, // "123456"
  email: { type: String, default: "" },
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  points: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Historia działań (punkty, zamówienia, kody)
const AppHistorySchema = new mongoose.Schema({
  milkId: { type: String, required: true },
  type: { type: String, required: true }, // "points" | "order" | "code" | ...
  detail: { type: String, default: "" },
  ts: { type: Date, default: Date.now },
});

// Kody do realizacji (nagrody / vouchery)
const AppCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // np. MSB-AB12CD
  milkId: { type: String, required: true },
  rewardTitle: { type: String, default: "" },
  status: { type: String, enum: ["pending", "redeemed"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  redeemedAt: { type: Date, default: null },
});

// Zamówienia (Zamów i odbierz) z app.html
const OrderSchema = new mongoose.Schema({
  milkId: { type: String, default: "" }, // 6-cyfrowy kod z app
  items: [{ title: String, qty: Number, price: Number }],
  total: { type: Number, default: 0 },
  pickupTime: { type: String, default: "" },
  pickupLocation: { type: String, default: "" },
  notes: { type: String, default: "" },
  status: { type: String, default: "Przyjęte" }, // Przyjęte/W realizacji/Gotowe/Wydane/Anulowane
  createdAt: { type: Date, default: Date.now },
});

const Product = mongoose.model("Product", ProductSchema);
const Reservation = mongoose.model("Reservation", ReservationSchema);
const HappyBar = mongoose.model("HappyBar", HappySchema);
const Employee = mongoose.model("Employee", EmployeeSchema);

const AppUser = mongoose.model("AppUser", AppUserSchema);
const AppHistory = mongoose.model("AppHistory", AppHistorySchema);
const AppCode = mongoose.model("AppCode", AppCodeSchema);
const Order = mongoose.model("Order", OrderSchema);

// ==========================
//  BASIC EXPRESS CONFIG
// ==========================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// statics (root)
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ["html"],
  })
);

// uploads
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safeName = Date.now() + "-" + file.originalname.replace(/[^\w.-]/g, "_");
    cb(null, safeName);
  },
});
const upload = multer({ storage });

app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "Brak pliku" });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

// ==========================
//  SOCKET.IO
// ==========================
io.on("connection", (socket) => {
  socket.on("disconnect", () => {});
});

// ==========================
//  HELPERS
// ==========================
function fixPin4(pin) {
  return String(pin || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
}
function fixMilkId6(milkId) {
  return String(milkId || "").replace(/\D/g, "").padStart(6, "0").slice(0, 6);
}
function calcPoints(amountPLN) {
  const amt = Number(String(amountPLN || "").replace(",", "."));
  if (!isFinite(amt) || amt <= 0) return 0;
  return Math.floor(amt / 10); // 10 zł = 1 pkt
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "MSB-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ==========================
//  API: LOGIN BY PIN
// ==========================
app.post("/api/login", async (req, res) => {
  try {
    const { pin } = req.body || {};
    const fixedPin = fixPin4(pin);

    // właściciel
    if (fixedPin === "0051") {
      return res.json({
        ok: true,
        role: "owner",
        user: { name: "Właściciel", pin: fixedPin },
      });
    }

    // manager / employee
    const emp = await Employee.findOne({ pin: fixedPin });
    if (!emp) return res.status(401).json({ ok: false, message: "Niepoprawny kod" });

    res.json({
      ok: true,
      role: emp.role,
      user: { id: emp._id, name: emp.name, pin: emp.pin },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd logowania" });
  }
});

// ==========================
//  API: EMPLOYEES
// ==========================
app.get("/api/pracownicy", async (req, res) => {
  try {
    const list = await Employee.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd pobierania pracowników" });
  }
});

app.post("/api/pracownicy", async (req, res) => {
  try {
    const { name, pin, role } = req.body || {};
    const fixedPin = fixPin4(pin);
    const fixedRole = role === "manager" ? "manager" : "employee";

    if (!name || fixedPin.length !== 4) {
      return res.status(400).json({ ok: false, message: "Podaj imię i PIN (4 cyfry)" });
    }
    if (fixedPin === "0051") {
      return res.status(400).json({ ok: false, message: "Ten PIN jest zarezerwowany dla właściciela" });
    }

    const exists = await Employee.findOne({ pin: fixedPin });
    if (exists) return res.status(400).json({ ok: false, message: "Ten PIN już istnieje" });

    const emp = await Employee.create({
      name: String(name).trim(),
      pin: fixedPin,
      role: fixedRole,
    });

    res.json({ ok: true, employee: emp });
  } catch (e) {
    console.error(e);
    if (String(e).includes("E11000")) {
      return res.status(400).json({ ok: false, message: "Ten PIN już istnieje" });
    }
    res.status(500).json({ ok: false, message: "Błąd dodawania pracownika" });
  }
});

app.delete("/api/pracownicy/:id", async (req, res) => {
  try {
    await Employee.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd usuwania pracownika" });
  }
});

// ==========================
//  API: DATA (dla index.html)
// ==========================
app.get("/api/data", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    const reservations = await Reservation.find().sort({ createdAt: -1 });
    const happyDoc = await HappyBar.findOne().sort({ updatedAt: -1 });

    res.json({
      products,
      reservations,
      happy: happyDoc?.text || "",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd /api/data" });
  }
});

// ==========================
//  API: PRODUCTS
// ==========================
app.get("/api/produkty", async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json(products);
});

app.post("/api/produkty", async (req, res) => {
  try {
    const p = req.body || {};
    const product = await Product.create({
      title: p.title || p.name || "Produkt",
      desc: p.desc || p.description || "",
      price: p.price ?? "",
      image: p.image || "",
    });

    io.emit("products-updated", await Product.find().sort({ createdAt: -1 }));
    res.json({ ok: true, product });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd dodawania produktu" });
  }
});

app.put("/api/produkty/:id", async (req, res) => {
  try {
    const updated = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ ok: false, message: "Nie znaleziono produktu" });

    io.emit("products-updated", await Product.find().sort({ createdAt: -1 }));
    res.json({ ok: true, product: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd edycji produktu" });
  }
});

app.delete("/api/produkty/:id", async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    io.emit("products-updated", await Product.find().sort({ createdAt: -1 }));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd usuwania produktu" });
  }
});

// ==========================
//  API: RESERVATIONS
// ==========================
app.get("/api/rezerwacje", async (req, res) => {
  const reservations = await Reservation.find().sort({ createdAt: -1 });
  res.json(reservations);
});

// UWAGA: app.html musi wysyłać do tego endpointu, żeby było w admin.html
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
      source: String(r.source || "web"),
    });

    io.emit("new-reservation", reservation);
    res.json({ ok: true, reservation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu rezerwacji" });
  }
});

app.delete("/api/rezerwacje/:id", async (req, res) => {
  try {
    await Reservation.findByIdAndDelete(req.params.id);
    io.emit("reservations-updated", await Reservation.find().sort({ createdAt: -1 }));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd usuwania rezerwacji" });
  }
});

// ==========================
//  API: HAPPY BAR
// ==========================
app.post("/api/happy", async (req, res) => {
  try {
    const { happy } = req.body || {};
    const text = String(happy || "");
    await HappyBar.create({ text, updatedAt: new Date() });

    io.emit("happy-updated", text);
    res.json({ ok: true, happy: text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu paska informacji" });
  }
});

// ==========================
//  API: ADMIN (APP PANEL) — appadmin.html
// ==========================

// stats
app.get("/api/admin/stats", async (req, res) => {
  try {
    const usersCount = await AppUser.countDocuments();
    const totalPointsAgg = await AppUser.aggregate([
      { $group: { _id: null, sum: { $sum: "$points" } } },
    ]);
    const totalPoints = totalPointsAgg?.[0]?.sum || 0;

    const totalOrders = await Order.countDocuments();
    const pendingCodes = await AppCode.countDocuments({ status: "pending" });

    res.json({
      users: usersCount,
      totalPoints,
      totalOrders,
      pendingCodes,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd statystyk" });
  }
});

// users list
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await AppUser.find().sort({ createdAt: -1 });
    res.json(
      users.map((u) => ({
        milkId: u.milkId,
        email: u.email || "",
        name: u.name || "",
        phone: u.phone || "",
        points: u.points || 0,
        createdAt: u.createdAt,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd klientów" });
  }
});

// user history
app.get("/api/admin/users/:milkId/history", async (req, res) => {
  try {
    const milkId = fixMilkId6(req.params.milkId);
    const hist = await AppHistory.find({ milkId }).sort({ ts: -1 }).limit(200);
    res.json(hist.map((h) => ({ ts: h.ts, type: h.type, detail: h.detail })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd historii" });
  }
});

// add points
app.post("/api/admin/add-points", async (req, res) => {
  try {
    const { milkId, amountPLN, points } = req.body || {};
    const id = fixMilkId6(milkId);

    const pts = Number(points ?? calcPoints(amountPLN));
    if (!id || id.length !== 6) {
      return res.status(400).json({ ok: false, message: "Nieprawidłowy Milk ID" });
    }
    if (!isFinite(pts) || pts <= 0) {
      return res.status(400).json({ ok: false, message: "Punkty muszą być > 0" });
    }

    // ensure user exists
    let user = await AppUser.findOne({ milkId: id });
    if (!user) {
      user = await AppUser.create({ milkId: id, points: 0 });
    }

    user.points = Number(user.points || 0) + pts;
    await user.save();

    await AppHistory.create({
      milkId: id,
      type: "points",
      detail: `Dodano +${pts} pkt (kwota: ${String(amountPLN || "").replace(",", ".")} PLN)`,
    });

    io.emit("app:points", { milkId: id, points: user.points });

    res.json({ ok: true, milkId: id, pointsAdded: pts, totalPoints: user.points });
  } catch (e) {
    console.error(e);
    if (String(e).includes("E11000")) {
      return res.status(400).json({ ok: false, message: "Konflikt danych" });
    }
    res.status(500).json({ ok: false, message: "Błąd dodawania punktów" });
  }
});

// ==========================
//  API: ADMIN ORDERS (appadmin + PWA)
// ==========================

app.get("/api/admin/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(
      orders.map((o) => ({
        id: String(o._id),
        milkId: o.milkId || "",
        items: o.items || [],
        total: o.total || 0,
        pickupTime: o.pickupTime || "",
        pickupLocation: o.pickupLocation || "",
        notes: o.notes || "",
        status: o.status || "Przyjęte",
        createdAt: o.createdAt,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zamówień" });
  }
});

app.post("/api/admin/orders", async (req, res) => {
  try {
    const o = req.body || {};
    const items = Array.isArray(o.items) ? o.items : [];
    const total = Number(o.total || 0);

    if (!items.length) return res.status(400).json({ ok: false, message: "Brak pozycji w zamówieniu" });
    if (!o.pickupTime) return res.status(400).json({ ok: false, message: "Brak godziny odbioru" });
    if (!o.pickupLocation) return res.status(400).json({ ok: false, message: "Brak lokalu" });

    const milkId = o.milkId ? fixMilkId6(o.milkId) : "";

    const order = await Order.create({
      milkId,
      items: items.map((i) => ({
        title: String(i.title || ""),
        qty: Number(i.qty || 0),
        price: Number(i.price || 0),
      })),
      total: isFinite(total) ? total : 0,
      pickupTime: String(o.pickupTime || ""),
      pickupLocation: String(o.pickupLocation || ""),
      notes: String(o.notes || ""),
      status: String(o.status || "Przyjęte"),
    });

    // ensure user exists if milkId provided
    if (milkId) {
      const user = await AppUser.findOne({ milkId });
      if (!user) await AppUser.create({ milkId, points: 0 });
      await AppHistory.create({ milkId, type: "order", detail: `Zamówienie: ${order.pickupLocation} • ${order.pickupTime} • ${order.total} PLN` });
    }

    io.emit("order:new", order);

    res.json({ ok: true, order: { id: String(order._id) } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu zamówienia" });
  }
});

app.put("/api/admin/orders/:id", async (req, res) => {
  try {
    const updated = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ ok: false, message: "Nie znaleziono zamówienia" });

    io.emit("order:updated", updated);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd aktualizacji zamówienia" });
  }
});

// ==========================
//  API: ADMIN CODES (appadmin)
// ==========================

// lista kodów pending
app.get("/api/admin/codes", async (req, res) => {
  try {
    const codes = await AppCode.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json(
      codes.map((c) => ({
        code: c.code,
        milkId: c.milkId,
        rewardTitle: c.rewardTitle || "",
        createdAt: c.createdAt,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd kodów" });
  }
});

// sprawdź kod
app.post("/api/admin/codes/check", async (req, res) => {
  try {
    const { code } = req.body || {};
    const normalized = String(code || "").trim();
    if (!normalized) return res.status(400).json({ ok: false, message: "Brak kodu" });

    const c = await AppCode.findOne({ code: normalized });
    if (!c) return res.status(404).json({ ok: false, message: "Kod nieprawidłowy" });
    if (c.status !== "pending") return res.status(400).json({ ok: false, message: "Kod już zrealizowany" });

    res.json({ code: c.code, milkId: c.milkId, rewardTitle: c.rewardTitle || "" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd weryfikacji kodu" });
  }
});

// zrealizuj kod
app.post("/api/admin/codes/redeem", async (req, res) => {
  try {
    const { code } = req.body || {};
    const normalized = String(code || "").trim();
    if (!normalized) return res.status(400).json({ ok: false, message: "Brak kodu" });

    const c = await AppCode.findOne({ code: normalized });
    if (!c) return res.status(404).json({ ok: false, message: "Kod nieprawidłowy" });
    if (c.status !== "pending") return res.status(400).json({ ok: false, message: "Kod już zrealizowany" });

    c.status = "redeemed";
    c.redeemedAt = new Date();
    await c.save();

    await AppHistory.create({
      milkId: c.milkId,
      type: "code",
      detail: `Zrealizowano kod: ${c.code} (${c.rewardTitle || "nagroda"})`,
    });

    io.emit("code:redeemed", { code: c.code, milkId: c.milkId });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Nie udało się zrealizować kodu" });
  }
});

// ==========================
//  (opcjonalne) API: GENERUJ KOD (np. po wymianie nagrody w app)
//  jeśli kiedyś zechcesz: app.html -> POST /api/app/rewards/redeem
// ==========================
app.post("/api/app/rewards/redeem", async (req, res) => {
  try {
    const { milkId, rewardTitle } = req.body || {};
    const id = fixMilkId6(milkId);
    if (!id || id.length !== 6) return res.status(400).json({ ok: false, message: "Nieprawidłowy Milk ID" });

    // ensure user exists
    let user = await AppUser.findOne({ milkId: id });
    if (!user) user = await AppUser.create({ milkId: id, points: 0 });

    // generuj kod uniklany
    let code = makeCode();
    for (let i = 0; i < 6; i++) {
      const exists = await AppCode.findOne({ code });
      if (!exists) break;
      code = makeCode();
    }

    const doc = await AppCode.create({
      code,
      milkId: id,
      rewardTitle: String(rewardTitle || "Nagroda"),
      status: "pending",
    });

    await AppHistory.create({
      milkId: id,
      type: "code",
      detail: `Wygenerowano kod: ${doc.code} (${doc.rewardTitle})`,
    });

    io.emit("code:new", { code: doc.code, milkId: doc.milkId, rewardTitle: doc.rewardTitle });

    res.json({ ok: true, code: doc.code });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd generowania kodu" });
  }
});

// ==========================
//  ROUTES (CLEAN URLS)
// ==========================

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/menu", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "menu.html")));
app.get("/app", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.html")));
app.get("/appadmin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "appadmin.html")));
app.get("/aplikacja", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "aplikacja.html")));

// SEO przekierowania
app.get("/admin.html", (req, res) => res.redirect(301, "/admin"));
app.get("/menu.html", (req, res) => res.redirect(301, "/menu"));
app.get("/app.html", (req, res) => res.redirect(301, "/app"));
app.get("/appadmin.html", (req, res) => res.redirect(301, "/appadmin"));
app.get("/aplikacja.html", (req, res) => res.redirect(301, "/aplikacja"));
app.get("/index.html", (req, res) => res.redirect(301, "/"));

// favicon
app.get("/favicon.ico", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "favicon.ico")));

// fallback: jak pliku nie ma, a ktoś wchodzi na /cos -> index.html
app.get("*", (req, res) => {
  // jeśli ktoś prosi o prawdziwy plik i go nie ma -> 404
  if (req.path.includes(".") && !fs.existsSync(path.join(PUBLIC_DIR, req.path))) {
    return res.status(404).send("Not found");
  }
  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ==========================
//  START
// ==========================
server.listen(PORT, () => {
  console.log("MilkShake Bar server running on port:", PORT);
});

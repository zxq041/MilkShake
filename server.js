// server.js — MilkShake Bar backend (Express + Socket.IO + MongoDB)
// Obsługuje: strona główna, menu, admin.html, appadmin.html, app.html
// + rezerwacje, produkty, happy bar, pracownicy, zamówienia (Zamów i odbierz),
// + panel aplikacji (admin API): users/points/history/orders/codes/stats

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
const ProductSchema = new mongoose.Schema({
  title: { type: String, required: true },
  desc: { type: String, default: "" },
  price: { type: String, default: "" },
  image: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

const ReservationSchema = new mongoose.Schema({
  source: { type: String, default: "index" }, // index / app
  name: { type: String, required: true },
  phone: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  time: { type: String, required: true }, // HH:mm
  guests: { type: String, required: true },
  room: { type: String, required: true },
  notes: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

const HappySchema = new mongoose.Schema({
  text: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

// Pracownicy
const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  pin: { type: String, required: true, unique: true }, // 4 cyfry
  role: { type: String, enum: ["manager", "employee"], default: "employee" },
  createdAt: { type: Date, default: Date.now },
});

// Użytkownicy aplikacji (Milk ID)
const MilkUserSchema = new mongoose.Schema({
  milkId: { type: String, required: true, unique: true },
  email: { type: String, default: "" },
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  points: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Historia (punkty / zamówienia / kody / nagrody)
const MilkHistorySchema = new mongoose.Schema({
  milkId: { type: String, required: true },
  type: { type: String, default: "action" }, // points/order/code/reward/other
  detail: { type: String, default: "" },
  ts: { type: Date, default: Date.now },
});

// Zamówienia “Zamów i odbierz”
const OrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // uuid z app
  milkId: { type: String, default: "" }, // 6-cyfrowy kod (Twoje "Milk ID")
  items: [
    {
      title: String,
      qty: Number,
      price: Number,
    },
  ],
  total: { type: Number, default: 0 },
  pickupTime: { type: String, default: "" },
  pickupLocation: { type: String, default: "" }, // Słupsk/Rowy
  notes: { type: String, default: "" },
  status: {
    type: String,
    enum: ["Przyjęte", "W realizacji", "Gotowe", "Wydane", "Anulowane"],
    default: "Przyjęte",
  },
  createdAt: { type: Date, default: Date.now },
});

// Kody do realizacji (nagrody/vouchery)
const CodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // np. MSB-AB12CD
  milkId: { type: String, required: true },
  rewardTitle: { type: String, default: "" },
  status: { type: String, enum: ["pending", "redeemed"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  redeemedAt: { type: Date, default: null },
});

const Product = mongoose.model("Product", ProductSchema);
const Reservation = mongoose.model("Reservation", ReservationSchema);
const HappyBar = mongoose.model("HappyBar", HappySchema);
const Employee = mongoose.model("Employee", EmployeeSchema);
const MilkUser = mongoose.model("MilkUser", MilkUserSchema);
const MilkHistory = mongoose.model("MilkHistory", MilkHistorySchema);
const Order = mongoose.model("Order", OrderSchema);
const Code = mongoose.model("Code", CodeSchema);

// ==========================
//  BASIC EXPRESS CONFIG
// ==========================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// uploads
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const safeName =
      Date.now() + "-" + file.originalname.replace(/[^\w.-]/g, "_");
    cb(null, safeName);
  },
});
const upload = multer({ storage });

app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ ok: false, message: "Brak pliku" });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

// ==========================
//  SOCKET.IO
// ==========================
io.on("connection", (socket) => {
  socket.on("disconnect", () => {});
});

// ==========================
//  API: LOGIN BY PIN
// ==========================
app.post("/api/login", async (req, res) => {
  try {
    const { pin } = req.body || {};
    const fixedPin = String(pin || "")
      .replace(/\D/g, "")
      .padStart(4, "0")
      .slice(0, 4);

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
    if (!emp) {
      return res.status(401).json({ ok: false, message: "Niepoprawny kod" });
    }

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

    const fixedPin = String(pin || "")
      .replace(/\D/g, "")
      .padStart(4, "0")
      .slice(0, 4);
    const fixedRole = role === "manager" ? "manager" : "employee";

    if (!name || fixedPin.length !== 4) {
      return res
        .status(400)
        .json({ ok: false, message: "Podaj imię i PIN (4 cyfry)" });
    }

    if (fixedPin === "0051") {
      return res
        .status(400)
        .json({ ok: false, message: "Ten PIN jest zarezerwowany dla właściciela" });
    }

    const exists = await Employee.findOne({ pin: fixedPin });
    if (exists) {
      return res.status(400).json({ ok: false, message: "Ten PIN już istnieje" });
    }

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
    const id = req.params.id;
    const updated = await Product.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated)
      return res.status(404).json({ ok: false, message: "Nie znaleziono produktu" });

    io.emit("products-updated", await Product.find().sort({ createdAt: -1 }));
    res.json({ ok: true, product: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd edycji produktu" });
  }
});

app.delete("/api/produkty/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await Product.findByIdAndDelete(id);

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

app.post("/api/rezerwacje", async (req, res) => {
  try {
    const r = req.body || {};
    if (!r.name || !r.phone || !r.date || !r.time || !r.guests || !r.room) {
      return res
        .status(400)
        .json({ ok: false, message: "Uzupełnij wszystkie wymagane pola." });
    }

    const reservation = await Reservation.create({
      source: String(r.source || "index"),
      name: String(r.name),
      phone: String(r.phone),
      date: String(r.date),
      time: String(r.time),
      guests: String(r.guests),
      room: String(r.room),
      notes: String(r.notes || ""),
    });

    io.emit("new-reservation", reservation); // migawka w admin.html
    io.emit("reservations-updated", await Reservation.find().sort({ createdAt: -1 }));
    res.json({ ok: true, reservation });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu rezerwacji" });
  }
});

// EDYCJA rezerwacji (wymagane przez Ciebie)
app.put("/api/rezerwacje/:id", async (req, res) => {
  try {
    const updated = await Reservation.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ ok: false, message: "Nie znaleziono rezerwacji" });

    io.emit("reservation-updated", updated);
    io.emit("reservations-updated", await Reservation.find().sort({ createdAt: -1 }));
    res.json({ ok: true, reservation: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd edycji rezerwacji" });
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
//  API: APP (Orders + Users + Points + Codes) — pod appadmin.html
// ==========================

async function ensureMilkUser(milkId) {
  const id = String(milkId || "").trim();
  if (!id) return null;
  let u = await MilkUser.findOne({ milkId: id });
  if (!u) u = await MilkUser.create({ milkId: id });
  return u;
}

// Stats
app.get("/api/admin/stats", async (req, res) => {
  try {
    const users = await MilkUser.countDocuments();
    const totalPointsAgg = await MilkUser.aggregate([{ $group: { _id: null, s: { $sum: "$points" } } }]);
    const totalPoints = totalPointsAgg?.[0]?.s || 0;

    const totalOrders = await Order.countDocuments();
    const pendingCodes = await Code.countDocuments({ status: "pending" });

    res.json({ users, totalPoints, totalOrders, pendingCodes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd statystyk" });
  }
});

// Users
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await MilkUser.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd klientów" });
  }
});

app.get("/api/admin/users/:milkId/history", async (req, res) => {
  try {
    const milkId = String(req.params.milkId || "");
    const hist = await MilkHistory.find({ milkId }).sort({ ts: -1 }).limit(250);
    res.json(hist.map(h => ({ ts: h.ts, type: h.type, detail: h.detail })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd historii" });
  }
});

// Orders
app.get("/api/admin/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(500);
    res.json(orders);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zamówień" });
  }
});

// Zmiana statusu zamówienia (opcjonalnie do paneli)
app.put("/api/admin/orders/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const { status } = req.body || {};
    const allowed = ["Przyjęte", "W realizacji", "Gotowe", "Wydane", "Anulowane"];
    const st = allowed.includes(status) ? status : "Przyjęte";

    const updated = await Order.findOneAndUpdate({ id }, { status: st }, { new: true });
    if (!updated) return res.status(404).json({ ok: false, message: "Nie znaleziono zamówienia" });

    io.emit("order-updated", updated);
    res.json({ ok: true, order: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd statusu" });
  }
});

// App endpoint: tworzenie zamówienia z app.html (ważne!)
app.post("/api/orders", async (req, res) => {
  try {
    const o = req.body || {};
    const id = String(o.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, message: "Brak ID" });

    // jeśli już istnieje — nie duplikujemy
    const exists = await Order.findOne({ id });
    if (exists) return res.json({ ok: true, order: exists, duplicated: true });

    const milkId = String(o.milkId || "").trim();
    if (milkId) await ensureMilkUser(milkId);

    const items = Array.isArray(o.items) ? o.items.map(i => ({
      title: String(i.title || ""),
      qty: Number(i.qty || 0),
      price: Number(i.price || 0),
    })) : [];

    const total = Number(o.total || items.reduce((s, i) => s + i.price * i.qty, 0));

    const order = await Order.create({
      id,
      milkId,
      items,
      total,
      pickupTime: String(o.pickupTime || ""),
      pickupLocation: String(o.pickupLocation || ""),
      notes: String(o.notes || ""),
      status: "Przyjęte",
    });

    // historia
    if (milkId) {
      await MilkHistory.create({
        milkId,
        type: "order",
        detail: `Zamówienie: ${order.pickupLocation || "-"} ${order.pickupTime || "-"} • ${order.total} zł • status: ${order.status}`,
      });
    }

    // realtime dla admina (migawka) + appadmin
    io.emit("new-order", order);
    io.emit("orders-updated", await Order.find().sort({ createdAt: -1 }).limit(500));

    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu zamówienia" });
  }
});

// Add points
app.post("/api/admin/add-points", async (req, res) => {
  try {
    const { milkId, amountPLN, points } = req.body || {};
    const id = String(milkId || "").trim();
    const pts = Number(points || 0);

    if (!id) return res.status(400).json({ ok: false, message: "Brak Milk ID" });
    if (!Number.isFinite(pts) || pts <= 0) return res.status(400).json({ ok: false, message: "Zła liczba punktów" });

    const user = await ensureMilkUser(id);
    user.points = Number(user.points || 0) + pts;
    await user.save();

    await MilkHistory.create({
      milkId: id,
      type: "points",
      detail: `Dodano +${pts} pkt (kwota: ${Number(amountPLN || 0)} zł)`,
    });

    io.emit("users-updated", await MilkUser.find().sort({ createdAt: -1 }));
    res.json({ ok: true, pointsAdded: pts, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd dodawania punktów" });
  }
});

// Codes list
app.get("/api/admin/codes", async (req, res) => {
  try {
    const codes = await Code.find({ status: "pending" }).sort({ createdAt: -1 }).limit(500);
    res.json(codes);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd kodów" });
  }
});

// Check code
app.post("/api/admin/codes/check", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = await Code.findOne({ code: String(code || "").trim() });
    if (!c || c.status !== "pending") return res.status(400).json({ ok: false, message: "Kod nieprawidłowy" });
    res.json({ code: c.code, milkId: c.milkId, rewardTitle: c.rewardTitle });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd kodu" });
  }
});

// Redeem code
app.post("/api/admin/codes/redeem", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = await Code.findOne({ code: String(code || "").trim() });
    if (!c || c.status !== "pending") return res.status(400).json({ ok: false, message: "Kod nieprawidłowy" });

    c.status = "redeemed";
    c.redeemedAt = new Date();
    await c.save();

    await ensureMilkUser(c.milkId);
    await MilkHistory.create({
      milkId: c.milkId,
      type: "code",
      detail: `Zrealizowano kod: ${c.code} (${c.rewardTitle || "nagroda"})`,
    });

    io.emit("codes-updated", await Code.find({ status: "pending" }).sort({ createdAt: -1 }));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd realizacji" });
  }
});

// (Opcjonalne) tworzenie kodu nagrody z app — jeśli kiedyś podłączysz realne nagrody
app.post("/api/codes/create", async (req, res) => {
  try {
    const { milkId, rewardTitle } = req.body || {};
    const id = String(milkId || "").trim();
    if (!id) return res.status(400).json({ ok: false, message: "Brak Milk ID" });

    await ensureMilkUser(id);

    const code = "MSB-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const c = await Code.create({ code, milkId: id, rewardTitle: String(rewardTitle || "Nagroda") });

    await MilkHistory.create({
      milkId: id,
      type: "reward",
      detail: `Utworzono kod nagrody: ${c.code} (${c.rewardTitle})`,
    });

    io.emit("codes-updated", await Code.find({ status: "pending" }).sort({ createdAt: -1 }));
    res.json({ ok: true, code: c.code });
  } catch (e) {
    console.error(e);
    if (String(e).includes("E11000")) return res.status(400).json({ ok: false, message: "Kolizja kodu, spróbuj ponownie" });
    res.status(500).json({ ok: false, message: "Błąd tworzenia kodu" });
  }
});

// ==========================
//  ROUTES (CLEAN URLS)
// ==========================
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/appadmin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "appadmin.html")));
app.get("/menu", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "menu.html")));
app.get("/app", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.html")));

app.get("/menu.html", (req, res) => res.redirect(301, "/menu"));
app.get("/admin.html", (req, res) => res.redirect(301, "/admin"));
app.get("/appadmin.html", (req, res) => res.redirect(301, "/appadmin"));
app.get("/app.html", (req, res) => res.redirect(301, "/app"));
app.get("/index.html", (req, res) => res.redirect(301, "/"));

app.get("/favicon.ico", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "favicon.ico")));

// Fallback — jeśli ktoś wejdzie w dziwny adres, daj index (żeby nie było Not Found)
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ==========================
//  START
// ==========================
server.listen(PORT, () => {
  console.log("MilkShake Bar server running on port:", PORT);
});

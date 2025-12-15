// server.js — MilkShake Bar backend (Express + Socket.IO + MongoDB)
// FULL: produkty, rezerwacje, happybar, pracownicy, konta PWA, zamówienia, punkty realtime, kody, statystyki appadmin

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
  name: { type: String, required: true },
  phone: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  guests: { type: String, required: true },
  room: { type: String, required: true },
  notes: { type: String, default: "" },

  email: { type: String, default: "" },
  milkId: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now },
});

const HappySchema = new mongoose.Schema({
  text: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  pin: { type: String, required: true, unique: true },
  role: { type: String, enum: ["manager", "employee"], default: "employee" },
  createdAt: { type: Date, default: Date.now },
});

// UWAGA: milkId jest unique + sparse -> pozwala istnieć dokumentom bez milkId podczas starych migracji,
// ale my i tak zawsze go ustawiamy w loginie.
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  milkId: { type: String, unique: true, sparse: true },
  points: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const HistorySchema = new mongoose.Schema({
  milkId: { type: String, required: true },
  type: { type: String, default: "action" },
  detail: { type: String, default: "" },
  ts: { type: Date, default: Date.now },
});

const OrderSchema = new mongoose.Schema({
  id: { type: String, required: true }, // uuid z app
  milkId: { type: String, required: true },
  email: { type: String, required: true },

  customerName: { type: String, default: "" },
  customerPhone: { type: String, default: "" },

  items: { type: Array, default: [] },
  total: { type: Number, default: 0 },
  pickupTime: { type: String, default: "" },
  pickupLocation: { type: String, default: "" },
  notes: { type: String, default: "" },

  status: { type: String, default: "Przyjęte" },
  createdAt: { type: Date, default: Date.now },
});

const CodeSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  milkId: { type: String, required: true },
  email: { type: String, default: "" },
  rewardId: { type: String, default: "" },
  rewardTitle: { type: String, default: "" },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
  redeemedAt: { type: Date, default: null },
});

const User = mongoose.model("User", UserSchema, "users");
const Order = mongoose.model("Order", OrderSchema, "orders");
const History = mongoose.model("History", HistorySchema, "histories");
const Code = mongoose.model("Code", CodeSchema, "codes");
const Reservation = mongoose.model("Reservation", ReservationSchema, "reservations");
const Product = mongoose.model("Product", ProductSchema, "products");
const Employee = mongoose.model("Employee", EmployeeSchema, "employees");
const HappyBar = mongoose.model("HappyBar", HappySchema, "happybars");


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
//  HELPERS
// ==========================
function fixedPin4(pin) {
  return String(pin || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
}

async function createHistory(milkId, type, detail) {
  if (!milkId) return;
  await History.create({ milkId, type, detail, ts: new Date() });
}

function generateMilkId6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function uniqueMilkId() {
  while (true) {
    const id = generateMilkId6();
    const exists = await User.findOne({ milkId: id });
    if (!exists) return id;
  }
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return "MSB-" + part();
}

async function uniqueCode() {
  while (true) {
    const code = generateCode();
    const exists = await Code.findOne({ code });
    if (!exists) return code;
  }
}

// Socket room helpers
function roomForMilk(milkId) {
  return `milk:${String(milkId || "").trim()}`;
}

function emitUserPoints(milkId, points) {
  if (!milkId) return;
  io.to(roomForMilk(milkId)).emit("points-updated", { milkId, points });
}

// ==========================
//  SOCKET.IO
// ==========================
io.on("connection", (socket) => {
  // PWA: po zalogowaniu powinna wysłać user:join {milkId}
  socket.on("user:join", ({ milkId } = {}) => {
    const mid = String(milkId || "").trim();
    if (!mid) return;
    socket.join(roomForMilk(mid));
  });

  socket.on("disconnect", () => {});
});

// ==========================
//  ADMIN LOGIN BY PIN
// ==========================
app.post("/api/login", async (req, res) => {
  try {
    const fixedPin = fixedPin4(req.body?.pin);

    if (fixedPin === "0051") {
      return res.json({ ok: true, role: "owner", user: { name: "Właściciel", pin: fixedPin } });
    }

    const emp = await Employee.findOne({ pin: fixedPin });
    if (!emp) return res.status(401).json({ ok: false, message: "Niepoprawny kod" });

    res.json({ ok: true, role: emp.role, user: { id: emp._id, name: emp.name, pin: emp.pin } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd logowania" });
  }
});

// ==========================
//  EMPLOYEES
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
    const fixedPin = fixedPin4(pin);
    const fixedRole = role === "manager" ? "manager" : "employee";

    if (!name || fixedPin.length !== 4) return res.status(400).json({ ok: false, message: "Podaj imię i PIN (4 cyfry)" });
    if (fixedPin === "0051") return res.status(400).json({ ok: false, message: "Ten PIN jest zarezerwowany dla właściciela" });

    const exists = await Employee.findOne({ pin: fixedPin });
    if (exists) return res.status(400).json({ ok: false, message: "Ten PIN już istnieje" });

    const emp = await Employee.create({ name: String(name).trim(), pin: fixedPin, role: fixedRole });
    res.json({ ok: true, employee: emp });
  } catch (e) {
    console.error(e);
    if (String(e).includes("E11000")) return res.status(400).json({ ok: false, message: "Ten PIN już istnieje" });
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
//  AUTH (PWA) — email login / create
// ==========================
async function getOrCreateUserByEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return null;

  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      email,
      milkId: await uniqueMilkId(),
      points: 0,
    });
    await createHistory(user.milkId, "account", "Utworzono konto");
    return user;
  }

  // jeśli stary user bez milkId -> napraw
  if (!user.milkId) {
    user.milkId = await uniqueMilkId();
    await user.save();
    await createHistory(user.milkId, "account", "Nadano Milk ID (naprawa)");
  }

  return user;
}

app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await getOrCreateUserByEmail(req.body?.email);
    if (!user) return res.status(400).json({ ok: false, message: "Podaj email" });

    res.json({
      ok: true,
      user: {
        email: user.email,
        name: user.name,
        phone: user.phone,
        milkId: user.milkId,
        points: user.points,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd logowania" });
  }
});

// kompatybilność: jeśli app wołało /api/app/login
app.post("/api/app/login", async (req, res) => {
  req.url = "/api/auth/login";
  return app._router.handle(req, res, () => {});
});

app.post("/api/user/profile", async (req, res) => {
  try {
    const { email, name, phone } = req.body || {};
    const user = await getOrCreateUserByEmail(email);
    if (!user) return res.status(400).json({ ok: false, message: "Brak email" });

    user.name = String(name || "");
    user.phone = String(phone || "");
    if (!user.milkId) user.milkId = await uniqueMilkId();

    await user.save();
    await createHistory(user.milkId, "profile", "Zaktualizowano dane profilu");

    res.json({
      ok: true,
      user: { email: user.email, name: user.name, phone: user.phone, milkId: user.milkId, points: user.points },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu profilu" });
  }
});

app.get("/api/user", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ ok: false });

    // napraw brak milkId
    if (!user.milkId) {
      user.milkId = await uniqueMilkId();
      await user.save();
    }

    res.json({
      ok: true,
      user: { email: user.email, name: user.name, phone: user.phone, milkId: user.milkId, points: user.points },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

app.get("/api/user/history", async (req, res) => {
  try {
    const milkId = String(req.query.milkId || "").trim();
    if (!milkId) return res.json([]);
    const list = await History.find({ milkId }).sort({ ts: -1 }).limit(200);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// ==========================
//  DATA (dla index.html)
// ==========================
app.get("/api/data", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    const reservations = await Reservation.find().sort({ createdAt: -1 });
    const happyDoc = await HappyBar.findOne().sort({ updatedAt: -1 });

    res.json({ products, reservations, happy: happyDoc?.text || "" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd /api/data" });
  }
});

// ==========================
//  PRODUCTS
// ==========================
app.get("/api/produkty", async (req, res) => {
  res.json(await Product.find().sort({ createdAt: -1 }));
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
//  RESERVATIONS
// ==========================
app.get("/api/rezerwacje", async (req, res) => {
  res.json(await Reservation.find().sort({ createdAt: -1 }));
});

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
    });

    if (reservation.milkId) {
      await createHistory(
        reservation.milkId,
        "reservation",
        `Rezerwacja: ${reservation.date} ${reservation.time} (${reservation.guests} os.)`
      );
    }

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
//  HAPPY BAR
// ==========================
app.post("/api/happy", async (req, res) => {
  try {
    const text = String(req.body?.happy || "");
    await HappyBar.create({ text, updatedAt: new Date() });
    io.emit("happy-updated", text);
    res.json({ ok: true, happy: text });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zapisu paska informacji" });
  }
});

// ==========================
//  ORDERS (PWA)
// ==========================
app.get("/api/orders", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.json([]);
    res.json(await Order.find({ email }).sort({ createdAt: -1 }));
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const o = req.body || {};
    const email = String(o.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    const user = await getOrCreateUserByEmail(email);
    if (!user) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    if (!o.id || !o.items || !Array.isArray(o.items) || !o.items.length) {
      return res.status(400).json({ ok: false, message: "Brak pozycji" });
    }

    const milkId = String(o.milkId || user.milkId || "").trim();
    if (!milkId) return res.status(400).json({ ok: false, message: "Brak Milk ID" });

    const order = await Order.create({
      id: String(o.id),
      email,
      milkId,
      customerName: String(o.customerName || user.name || ""),
      customerPhone: String(o.customerPhone || user.phone || ""),
      items: o.items,
      total: Number(o.total || 0),
      pickupTime: String(o.pickupTime || ""),
      pickupLocation: String(o.pickupLocation || ""),
      notes: String(o.notes || ""),
      status: "Przyjęte",
    });

    await createHistory(milkId, "order", `Zamówienie: ${order.pickupLocation} ${order.pickupTime} • ${order.total} zł`);
    io.emit("new-order", order);

    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zamówienia" });
  }
});

// kompatybilność (stare app.html): POST /api/admin/orders
app.post("/api/admin/orders", async (req, res) => {
  req.url = "/api/orders";
  return app._router.handle(req, res, () => {});
});

// ==========================
//  REWARDS -> KODY
// ==========================
app.post("/api/rewards/redeem", async (req, res) => {
  try {
    const { email, rewardId, rewardTitle, cost } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    if (!em) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    const user = await getOrCreateUserByEmail(em);
    if (!user) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    const c = Number(cost || 0);
    if (!rewardId || !rewardTitle || c <= 0) return res.status(400).json({ ok: false, message: "Błędna nagroda" });
    if (user.points < c) return res.status(400).json({ ok: false, message: "Za mało punktów" });

    user.points -= c;
    await user.save();

    const code = await uniqueCode();
    const doc = await Code.create({
      code,
      milkId: user.milkId,
      email: user.email,
      rewardId: String(rewardId),
      rewardTitle: String(rewardTitle),
      status: "pending",
    });

    await createHistory(user.milkId, "code", `Wymieniono: -${c} pkt (${rewardTitle}) • Kod: ${code}`);
    io.emit("codes-updated");

    emitUserPoints(user.milkId, user.points);

    res.json({ ok: true, code: doc.code, rewardTitle: doc.rewardTitle, points: user.points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd realizacji nagrody" });
  }
});

// ==========================
//  APPADMIN — endpoints
// ==========================
app.get("/api/admin/stats", async (req, res) => {
  try {
    const users = await User.countDocuments();
    const aggPoints = await User.aggregate([{ $group: { _id: null, sum: { $sum: "$points" } } }]);
    const totalPoints = aggPoints?.[0]?.sum ?? 0;

    const totalOrders = await Order.countDocuments();
    const pendingCodes = await Code.countDocuments({ status: "pending" });

    res.json({ users, totalPoints, totalOrders, pendingCodes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ users: 0, totalPoints: 0, totalOrders: 0, pendingCodes: 0 });
  }
});

app.get("/api/admin/users", async (req, res) => {
  try {
    const list = await User.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

app.get("/api/admin/users/:milkId/history", async (req, res) => {
  try {
    const milkId = String(req.params.milkId || "").trim();
    const list = await History.find({ milkId }).sort({ ts: -1 }).limit(200);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

app.get("/api/admin/orders", async (req, res) => {
  try {
    const list = await Order.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// ✅ DODAWANIE PUNKTÓW: po milkId LUB po email
app.post("/api/admin/add-points", async (req, res) => {
  try {
    const { milkId, email, amountPLN, points } = req.body || {};
    const pts = Number(points || 0);

    if (pts <= 0) return res.status(400).json({ ok: false, message: "Błędna liczba punktów" });

    let user = null;

    if (milkId) user = await User.findOne({ milkId: String(milkId).trim() });
    if (!user && email) user = await User.findOne({ email: String(email).trim().toLowerCase() });

    if (!user) return res.status(404).json({ ok: false, message: "Nie znaleziono użytkownika" });

    if (!user.milkId) {
      user.milkId = await uniqueMilkId();
      await createHistory(user.milkId, "account", "Nadano Milk ID (naprawa przy punktach)");
    }

    user.points += pts;
    await user.save();

    await createHistory(user.milkId, "points", `Dodano +${pts} pkt (kwota: ${Number(amountPLN || 0).toFixed(2)} zł)`);

    // ✅ REALTIME DO PWA
    emitUserPoints(user.milkId, user.points);

    res.json({ ok: true, milkId: user.milkId, points: user.points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd dodawania punktów" });
  }
});

// ✅ MIGRACJA: nadaj milkId wszystkim userom bez milkId
// odpal raz w przeglądarce: /api/admin/fix-milkids
app.get("/api/admin/fix-milkids", async (req, res) => {
  try {
    const list = await User.find({ $or: [{ milkId: { $exists: false } }, { milkId: "" }, { milkId: null }] });
    let fixed = 0;

    for (const u of list) {
      u.milkId = await uniqueMilkId();
      await u.save();
      fixed++;
      await createHistory(u.milkId, "account", "Nadano Milk ID (migracja)");
    }

    res.json({ ok: true, fixed });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd migracji" });
  }
});

app.get("/api/admin/codes", async (req, res) => {
  try {
    const list = await Code.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

app.post("/api/admin/codes/check", async (req, res) => {
  try {
    const c = String(req.body?.code || "").trim().toUpperCase();
    if (!c) return res.status(400).json({ ok: false, message: "Brak kodu" });

    const doc = await Code.findOne({ code: c, status: "pending" });
    if (!doc) return res.status(400).json({ ok: false, message: "Kod nieprawidłowy" });

    res.json({ ok: true, code: doc.code, milkId: doc.milkId, rewardTitle: doc.rewardTitle });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd" });
  }
});

app.post("/api/admin/codes/redeem", async (req, res) => {
  try {
    const c = String(req.body?.code || "").trim().toUpperCase();
    if (!c) return res.status(400).json({ ok: false, message: "Brak kodu" });

    const doc = await Code.findOne({ code: c, status: "pending" });
    if (!doc) return res.status(400).json({ ok: false, message: "Kod nieprawidłowy" });

    doc.status = "redeemed";
    doc.redeemedAt = new Date();
    await doc.save();

    await createHistory(doc.milkId, "redeem", `Zrealizowano kod: ${doc.code} (${doc.rewardTitle})`);
    io.emit("codes-updated");

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd realizacji" });
  }
});

// ==========================
//  ROUTES (CLEAN URLS)
// ==========================
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/menu", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "menu.html")));
app.get("/app", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.html")));
app.get("/appadmin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "appadmin.html")));

app.get("/menu.html", (req, res) => res.redirect(301, "/menu"));
app.get("/admin.html", (req, res) => res.redirect(301, "/admin"));
app.get("/app.html", (req, res) => res.redirect(301, "/app"));
app.get("/appadmin.html", (req, res) => res.redirect(301, "/appadmin"));
app.get("/index.html", (req, res) => res.redirect(301, "/"));

app.get("/favicon.ico", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "favicon.ico")));

// SPA fallback
app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ==========================
//  START
// ==========================
server.listen(PORT, () => {
  console.log("MilkShake Bar server running on port:", PORT);
});


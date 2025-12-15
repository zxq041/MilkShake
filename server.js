// server.js — MilkShake Bar backend (Express + Socket.IO + MongoDB)
// Wersja: pełna (produkty, rezerwacje, happybar, pracownicy, konta PWA, zamówienia, punkty, kody, statystyki dla appadmin)
// + REALTIME POINTS dla PWA (Socket.IO)

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
});

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

  // opcjonalnie z PWA:
  email: { type: String, default: "" },
  milkId: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now },
});

const HappySchema = new mongoose.Schema({
  text: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

// Pracownicy (admin PIN)
const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  pin: { type: String, required: true, unique: true }, // 4 cyfry
  role: { type: String, enum: ["manager", "employee"], default: "employee" },
  createdAt: { type: Date, default: Date.now },
});

// Konta PWA (użytkownicy)
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  milkId: { type: String, unique: true },
  points: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Historia (dla panelu + PWA)
const HistorySchema = new mongoose.Schema({
  milkId: { type: String, required: true },
  type: { type: String, default: "action" }, // points/order/code/reservation/profile/account/redeem
  detail: { type: String, default: "" },
  ts: { type: Date, default: Date.now },
});

// Zamówienia (Zamów i odbierz)
const OrderSchema = new mongoose.Schema({
  id: { type: String, required: true }, // uuid z app
  milkId: { type: String, required: true },
  email: { type: String, required: true },

  customerName: { type: String, default: "" },
  customerPhone: { type: String, default: "" },

  items: { type: Array, default: [] }, // [{title, qty, price}]
  total: { type: Number, default: 0 },
  pickupTime: { type: String, default: "" },
  pickupLocation: { type: String, default: "" },
  notes: { type: String, default: "" },

  status: { type: String, default: "Przyjęte" }, // Przyjęte/W realizacji/Gotowe/Wydane/Anulowane
  createdAt: { type: Date, default: Date.now },
});

// Kody (nagrody/vouchery) do realizacji
const CodeSchema = new mongoose.Schema({
  code: { type: String, unique: true }, // np. MSB-AB12CD
  milkId: { type: String, required: true },
  email: { type: String, default: "" },
  rewardId: { type: String, default: "" },
  rewardTitle: { type: String, default: "" },
  status: { type: String, default: "pending" }, // pending/redeemed
  createdAt: { type: Date, default: Date.now },
  redeemedAt: { type: Date, default: null },
});

const Product = mongoose.model("Product", ProductSchema);
const Reservation = mongoose.model("Reservation", ReservationSchema);
const HappyBar = mongoose.model("HappyBar", HappySchema);
const Employee = mongoose.model("Employee", EmployeeSchema);
const User = mongoose.model("User", UserSchema);
const History = mongoose.model("History", HistorySchema);
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
//  SOCKET.IO (Realtime)
// ==========================
function userRoom(milkId) {
  return `user:${String(milkId || "").trim()}`;
}
function emitUserPoints(milkId, points) {
  if (!milkId) return;
  io.to(userRoom(milkId)).emit("user:points", { milkId: String(milkId), points: Number(points || 0) });
}
function emitUserProfile(milkId, user) {
  if (!milkId) return;
  io.to(userRoom(milkId)).emit("user:profile", {
    milkId: user?.milkId || milkId,
    email: user?.email || "",
    name: user?.name || "",
    phone: user?.phone || "",
    points: user?.points ?? 0,
  });
}

io.on("connection", (socket) => {
  // PWA: dołącz do pokoju usera (po milkId)
  socket.on("user:join", (payload) => {
    const milkId = String(payload?.milkId || "").trim();
    if (!milkId) return;
    socket.join(userRoom(milkId));
    socket.emit("user:joined", { ok: true, milkId });
  });

  socket.on("disconnect", () => {});
});

// ==========================
//  Helpers
// ==========================
function fixedPin4(pin) {
  return String(pin || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
}

async function createHistory(milkId, type, detail) {
  if (!milkId) return;
  await History.create({ milkId, type, detail, ts: new Date() });
}

function generateMilkId6() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
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

// ==========================
//  API: LOGIN BY PIN (admin)
// ==========================
app.post("/api/login", async (req, res) => {
  try {
    const { pin } = req.body || {};
    const fixedPin = fixedPin4(pin);

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
    const fixedPin = fixedPin4(pin);
    const fixedRole = role === "manager" ? "manager" : "employee";

    if (!name || fixedPin.length !== 4) {
      return res.status(400).json({ ok: false, message: "Podaj imię i PIN (4 cyfry)" });
    }
    if (fixedPin === "0051") {
      return res.status(400).json({ ok: false, message: "Ten PIN jest zarezerwowany dla właściciela" });
    }

    const exists = await Employee.findOne({ pin: fixedPin });
    if (exists) return res.status(400).json({ ok: false, message: "Ten PIN już istnieje" });

    const emp = await Employee.create({ name: String(name).trim(), pin: fixedPin, role: fixedRole });
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
//  API: AUTH (PWA) — logowanie / zakładanie konta
// ==========================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    if (!em) return res.status(400).json({ ok: false, message: "Podaj email" });

    let user = await User.findOne({ email: em });

    // nowy user
    if (!user) {
      user = await User.create({
        email: em,
        milkId: await uniqueMilkId(),
        points: 0,
      });
      await createHistory(user.milkId, "account", "Utworzono konto");
    }

    // NAPRAWA dla starych userów bez milkId
    if (!user.milkId) {
      user.milkId = await uniqueMilkId();
      await user.save();
      await createHistory(user.milkId, "account", "Uzupełniono brakujące MilkID");
    }

    // realtime: podeślij profil (opcjonalnie)
    // emitUserProfile(user.milkId, user);

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

// update danych profilu
app.post("/api/user/profile", async (req, res) => {
  try {
    const { email, name, phone } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    if (!em) return res.status(400).json({ ok: false, message: "Brak email" });

    const user = await User.findOneAndUpdate(
      { email: em },
      { name: String(name || ""), phone: String(phone || "") },
      { new: true }
    );

    if (!user) return res.status(404).json({ ok: false, message: "Nie znaleziono użytkownika" });

    // napraw milkId jeśli brak
    if (!user.milkId) {
      user.milkId = await uniqueMilkId();
      await user.save();
    }

    await createHistory(user.milkId, "profile", "Zaktualizowano dane profilu");

    // realtime: profil usera
    emitUserProfile(user.milkId, user);

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
    res.status(500).json({ ok: false, message: "Błąd zapisu profilu" });
  }
});

// pobranie świeżych danych usera (np. punkty)
app.get("/api/user", async (req, res) => {
  try {
    const em = String(req.query.email || "").trim().toLowerCase();
    if (!em) return res.status(400).json({ ok: false });
    const user = await User.findOne({ email: em });
    if (!user) return res.status(404).json({ ok: false });

    // napraw milkId jeśli brak
    if (!user.milkId) {
      user.milkId = await uniqueMilkId();
      await user.save();
    }

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
    res.status(500).json({ ok: false });
  }
});

// historia usera do PWA
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
//  API: RESERVATIONS (index + PWA)
// ==========================
app.get("/api/rezerwacje", async (req, res) => {
  const reservations = await Reservation.find().sort({ createdAt: -1 });
  res.json(reservations);
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
//  API: ORDERS (PWA)
// ==========================

async function handleCreateOrder(req, res) {
  try {
    const o = req.body || {};
    const email = String(o.email || "").trim().toLowerCase();
    const milkId = String(o.milkId || "").trim();

    if (!email || !milkId) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    // napraw milkId jeśli brak
    if (!user.milkId) {
      user.milkId = await uniqueMilkId();
      await user.save();
    }

    if (!o.id || !o.items || !Array.isArray(o.items) || !o.items.length) {
      return res.status(400).json({ ok: false, message: "Brak pozycji" });
    }

    const order = await Order.create({
      id: String(o.id),
      email,
      milkId: user.milkId, // bierzemy z usera jako źródło prawdy
      customerName: String(o.customerName || user.name || ""),
      customerPhone: String(o.customerPhone || user.phone || ""),
      items: o.items,
      total: Number(o.total || 0),
      pickupTime: String(o.pickupTime || ""),
      pickupLocation: String(o.pickupLocation || ""),
      notes: String(o.notes || ""),
      status: "Przyjęte",
    });

    await createHistory(user.milkId, "order", `Zamówienie: ${order.pickupLocation} ${order.pickupTime} • ${order.total} zł`);
    io.emit("new-order", order);

    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd zamówienia" });
  }
}

// lista zamówień usera
app.get("/api/orders", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.json([]);
    const list = await Order.find({ email }).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// tworzenie zamówienia (PWA)
app.post("/api/orders", handleCreateOrder);

// ==========================
//  API: REWARDS -> tworzy KOD, odejmuje punkty (PWA)
// ==========================
app.post("/api/rewards/redeem", async (req, res) => {
  try {
    const { email, rewardId, rewardTitle, cost } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    if (!em) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    const user = await User.findOne({ email: em });
    if (!user) return res.status(401).json({ ok: false, message: "Zaloguj się" });

    // napraw milkId jeśli brak
    if (!user.milkId) {
      user.milkId = await uniqueMilkId();
      await user.save();
    }

    const c = Number(cost || 0);
    if (!rewardId || !rewardTitle || c <= 0) {
      return res.status(400).json({ ok: false, message: "Błędna nagroda" });
    }

    if (user.points < c) {
      return res.status(400).json({ ok: false, message: "Za mało punktów" });
    }

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

    // realtime punkty do PWA
    emitUserPoints(user.milkId, user.points);

    res.json({
      ok: true,
      code: doc.code,
      rewardTitle: doc.rewardTitle,
      points: user.points,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd realizacji nagrody" });
  }
});

// ==========================
//  API: APPADMIN (panel aplikacji) — endpoints z appadmin.html
// ==========================

// stats
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

// users list
app.get("/api/admin/users", async (req, res) => {
  try {
    const list = await User.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// user history
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

// orders list (for appadmin)
app.get("/api/admin/orders", async (req, res) => {
  try {
    const list = await Order.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// add points — used by appadmin
app.post("/api/admin/add-points", async (req, res) => {
  try {
    const { milkId, amountPLN, points } = req.body || {};
    const mid = String(milkId || "").trim();
    const pts = Number(points || 0);

    if (!mid || pts <= 0) return res.status(400).json({ ok: false, message: "Błędne dane" });

    const user = await User.findOne({ milkId: mid });
    if (!user) return res.status(404).json({ ok: false, message: "Nie znaleziono Milk ID" });

    user.points += pts;
    await user.save();

    await createHistory(mid, "points", `Dodano +${pts} pkt (kwota: ${Number(amountPLN || 0).toFixed(2)} zł)`);

    // ✅ REALTIME: punkty do PWA NATYCHMIAST
    emitUserPoints(mid, user.points);

    res.json({ ok: true, points: user.points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd dodawania punktów" });
  }
});

// codes list (pending)
app.get("/api/admin/codes", async (req, res) => {
  try {
    const list = await Code.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// check code
app.post("/api/admin/codes/check", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = String(code || "").trim().toUpperCase();
    if (!c) return res.status(400).json({ ok: false, message: "Brak kodu" });

    const doc = await Code.findOne({ code: c, status: "pending" });
    if (!doc) return res.status(400).json({ ok: false, message: "Kod nieprawidłowy" });

    res.json({
      ok: true,
      code: doc.code,
      milkId: doc.milkId,
      rewardTitle: doc.rewardTitle,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd" });
  }
});

// redeem code
app.post("/api/admin/codes/redeem", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = String(code || "").trim().toUpperCase();
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

// ✅ ALIAS: żeby stare app.html z POST /api/admin/orders nie wywalało błędu
app.post("/api/admin/orders", handleCreateOrder);

// ==========================
//  ROUTES (CLEAN URLS)
// ==========================
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/menu", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "menu.html")));

app.get("/app", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.html")));
app.get("/appadmin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "appadmin.html")));

// przekierowania ze starych adresów *.html
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

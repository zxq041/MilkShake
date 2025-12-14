// server.js — MilkShake Bar backend (Express + Socket.IO + MongoDB)

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

// ✅ lepiej: statyczne pliki trzymaj w /public
const PUBLIC_DIR = path.join(__dirname, "public");

// ==========================
//  MONGODB CONNECT
// ==========================
const MONGO_URL = process.env.MONGO_URL;

if (!MONGO_URL) {
  console.error("❌ Brak MONGO_URL w zmiennych Railway!");
}

mongoose
  .connect(MONGO_URL, { dbName: "milkshakebar" })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("MongoDB connect error:", err));

// ==========================
//  MODELS (Twoje + nowe)
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
  createdAt: { type: Date, default: Date.now },
});

const HappySchema = new mongoose.Schema({
  text: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  pin: { type: String, required: true, unique: true }, // 4 cyfry
  role: { type: String, enum: ["manager", "employee"], default: "employee" },
  createdAt: { type: Date, default: Date.now },
});

// ====== NOWE: Aplikacja Milk (PWA + panel appadmin) ======
const MilkUserSchema = new mongoose.Schema({
  milkId: { type: String, required: true, unique: true }, // 6 cyfr
  email: { type: String, default: "" },
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  points: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const MilkHistorySchema = new mongoose.Schema({
  milkId: { type: String, required: true, index: true },
  type: { type: String, default: "action" }, // points|order|code|reward|...
  detail: { type: String, default: "" },
  ts: { type: Date, default: Date.now },
});

const MilkOrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // crypto.randomUUID z app
  milkId: { type: String, required: true, index: true },
  items: [
    {
      title: String,
      qty: Number,
      price: Number,
    },
  ],
  total: { type: Number, default: 0 },
  pickupTime: { type: String, default: "" },
  pickupLocation: { type: String, default: "" },
  notes: { type: String, default: "" },
  status: {
    type: String,
    default: "Przyjęte",
    enum: ["Przyjęte", "W realizacji", "Gotowe", "Wydane", "Anulowane"],
  },
  createdAt: { type: Date, default: Date.now },
});

const MilkCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // np. MSB-AB12CD
  milkId: { type: String, required: true, index: true },
  rewardId: { type: String, default: "" },
  rewardTitle: { type: String, default: "" },
  status: { type: String, default: "pending", enum: ["pending", "redeemed"] },
  createdAt: { type: Date, default: Date.now },
  redeemedAt: { type: Date, default: null },
});

const Product = mongoose.model("Product", ProductSchema);
const Reservation = mongoose.model("Reservation", ReservationSchema);
const HappyBar = mongoose.model("HappyBar", HappySchema);
const Employee = mongoose.model("Employee", EmployeeSchema);

const MilkUser = mongoose.model("MilkUser", MilkUserSchema);
const MilkHistory = mongoose.model("MilkHistory", MilkHistorySchema);
const MilkOrder = mongoose.model("MilkOrder", MilkOrderSchema);
const MilkCode = mongoose.model("MilkCode", MilkCodeSchema);

// ==========================
//  BASIC EXPRESS CONFIG
// ==========================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ statyczne pliki z /public
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
//  HELPERS
// ==========================
function fixedPin4(pin) {
  return String(pin || "")
    .replace(/\D/g, "")
    .padStart(4, "0")
    .slice(0, 4);
}

function fixedMilkId6(milkId) {
  return String(milkId || "")
    .replace(/\D/g, "")
    .padStart(6, "0")
    .slice(0, 6);
}

function calcPoints(amountPLN) {
  const amt = Number(String(amountPLN).replace(",", "."));
  if (!isFinite(amt) || amt <= 0) return 0;
  return Math.floor(amt / 10); // 10 zł = 1 pkt
}

function makeCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const rnd = () =>
    Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `MSB-${rnd()}`;
}

async function ensureMilkUser(milkId) {
  const id = fixedMilkId6(milkId);
  let user = await MilkUser.findOne({ milkId: id });
  if (!user) {
    user = await MilkUser.create({ milkId: id });
    await MilkHistory.create({
      milkId: id,
      type: "user",
      detail: "Utworzono konto Milk",
    });
  }
  return user;
}

// ==========================
//  API: LOGIN BY PIN (Twoje)
// ==========================
app.post("/api/login", async (req, res) => {
  try {
    const { pin } = req.body || {};
    const fp = fixedPin4(pin);

    // właściciel
    if (fp === "0051") {
      return res.json({
        ok: true,
        role: "owner",
        user: { name: "Właściciel", pin: fp },
      });
    }

    // manager / employee
    const emp = await Employee.findOne({ pin: fp });
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
//  API: EMPLOYEES (Twoje)
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

    const fp = fixedPin4(pin);
    const fr = role === "manager" ? "manager" : "employee";

    if (!name || fp.length !== 4) {
      return res
        .status(400)
        .json({ ok: false, message: "Podaj imię i PIN (4 cyfry)" });
    }

    if (fp === "0051") {
      return res.status(400).json({
        ok: false,
        message: "Ten PIN jest zarezerwowany dla właściciela",
      });
    }

    const exists = await Employee.findOne({ pin: fp });
    if (exists) {
      return res.status(400).json({ ok: false, message: "Ten PIN już istnieje" });
    }

    const emp = await Employee.create({
      name: String(name).trim(),
      pin: fp,
      role: fr,
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
//  API: PRODUCTS (Twoje)
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
//  API: RESERVATIONS (Twoje)
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
      name: String(r.name),
      phone: String(r.phone),
      date: String(r.date),
      time: String(r.time),
      guests: String(r.guests),
      room: String(r.room),
      notes: String(r.notes || ""),
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
    io.emit(
      "reservations-updated",
      await Reservation.find().sort({ createdAt: -1 })
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd usuwania rezerwacji" });
  }
});

// ==========================
//  API: HAPPY BAR (Twoje)
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

// =========================================================
//  ✅ API: APPADMIN (Twoje appadmin.html) -> /api/admin/*
// =========================================================

// stats
app.get("/api/admin/stats", async (req, res) => {
  try {
    const users = await MilkUser.countDocuments();
    const aggPoints = await MilkUser.aggregate([
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);
    const totalPoints = aggPoints?.[0]?.total ?? 0;

    const totalOrders = await MilkOrder.countDocuments();
    const pendingCodes = await MilkCode.countDocuments({ status: "pending" });

    res.json({ users, totalPoints, totalOrders, pendingCodes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd statystyk" });
  }
});

// users
app.get("/api/admin/users", async (req, res) => {
  try {
    const list = await MilkUser.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd klientów" });
  }
});

// user history
app.get("/api/admin/users/:milkId/history", async (req, res) => {
  try {
    const milkId = fixedMilkId6(req.params.milkId);
    const hist = await MilkHistory.find({ milkId }).sort({ ts: -1 }).limit(250);
    res.json(hist);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd historii" });
  }
});

// orders
app.get("/api/admin/orders", async (req, res) => {
  try {
    const list = await MilkOrder.find().sort({ createdAt: -1 }).limit(500);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd zamówień" });
  }
});

// add points
app.post("/api/admin/add-points", async (req, res) => {
  try {
    const { milkId, amountPLN, points } = req.body || {};
    const id = fixedMilkId6(milkId);

    if (!id || id.length !== 6) {
      return res.status(400).json({ message: "Nieprawidłowy Milk ID" });
    }

    const pts = Number.isFinite(Number(points))
      ? Number(points)
      : calcPoints(amountPLN);

    if (!pts || pts <= 0) {
      return res.status(400).json({ message: "Punkty muszą być > 0" });
    }

    const user = await ensureMilkUser(id);
    user.points = Number(user.points || 0) + pts;
    await user.save();

    await MilkHistory.create({
      milkId: id,
      type: "points",
      detail: `Dodano +${pts} pkt (kwota: ${amountPLN ?? "—"} PLN)`,
    });

    io.emit("milk:points-updated", { milkId: id, points: user.points });
    res.json({ ok: true, pointsAdded: pts, pointsTotal: user.points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd dodawania punktów" });
  }
});

// codes list
app.get("/api/admin/codes", async (req, res) => {
  try {
    const list = await MilkCode.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd kodów" });
  }
});

// code check
app.post("/api/admin/codes/check", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = await MilkCode.findOne({ code: String(code || "").trim() });

    if (!c) return res.status(400).json({ message: "Kod nieprawidłowy" });
    if (c.status !== "pending")
      return res.status(400).json({ message: "Kod już zrealizowany" });

    res.json({
      code: c.code,
      milkId: c.milkId,
      rewardTitle: c.rewardTitle || "—",
      rewardId: c.rewardId || "",
      status: c.status,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd sprawdzania kodu" });
  }
});

// code redeem
app.post("/api/admin/codes/redeem", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = await MilkCode.findOne({ code: String(code || "").trim() });
    if (!c) return res.status(400).json({ message: "Kod nieprawidłowy" });
    if (c.status !== "pending")
      return res.status(400).json({ message: "Kod już zrealizowany" });

    c.status = "redeemed";
    c.redeemedAt = new Date();
    await c.save();

    await MilkHistory.create({
      milkId: c.milkId,
      type: "code",
      detail: `Zrealizowano kod: ${c.code} (${c.rewardTitle || "—"})`,
    });

    io.emit("milk:code-redeemed", { code: c.code, milkId: c.milkId });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Nie udało się zrealizować kodu" });
  }
});

// =========================================================
//  ✅ API: APP (Twoje app.html) -> minimalnie, bez zmiany UI
// =========================================================

// 1) przypisz/utwórz user (Milk ID)
app.post("/api/app/ensure-user", async (req, res) => {
  try {
    const { milkId } = req.body || {};
    const id = fixedMilkId6(milkId);
    const user = await ensureMilkUser(id);
    res.json({ ok: true, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd tworzenia konta" });
  }
});

// 2) pobierz user
app.get("/api/app/users/:milkId", async (req, res) => {
  try {
    const milkId = fixedMilkId6(req.params.milkId);
    const user = await ensureMilkUser(milkId);
    res.json({ ok: true, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd pobierania usera" });
  }
});

// 3) historia punktów (dla PWA)
app.get("/api/app/users/:milkId/history", async (req, res) => {
  try {
    const milkId = fixedMilkId6(req.params.milkId);
    const hist = await MilkHistory.find({ milkId }).sort({ ts: -1 }).limit(200);
    res.json({ ok: true, history: hist });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd historii" });
  }
});

// 4) utwórz zamówienie (żeby appadmin widział)
app.post("/api/app/orders", async (req, res) => {
  try {
    const o = req.body || {};
    const milkId = fixedMilkId6(o.milkId);

    if (!milkId || milkId.length !== 6) {
      return res.status(400).json({ ok: false, message: "Brak Milk ID" });
    }
    if (!o.id) return res.status(400).json({ ok: false, message: "Brak ID zamówienia" });

    await ensureMilkUser(milkId);

    const order = await MilkOrder.create({
      id: String(o.id),
      milkId,
      items: Array.isArray(o.items) ? o.items : [],
      total: Number(o.total || 0),
      pickupTime: String(o.pickupTime || ""),
      pickupLocation: String(o.pickupLocation || ""),
      notes: String(o.notes || ""),
      status: "Przyjęte",
    });

    await MilkHistory.create({
      milkId,
      type: "order",
      detail: `Nowe zamówienie (${order.pickupLocation || "—"} • ${order.pickupTime || "—"}) suma: ${order.total || 0} PLN`,
    });

    io.emit("milk:order-new", order);
    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    if (String(e).includes("E11000")) {
      return res.json({ ok: true }); // jeśli ten sam order już istnieje - nie wywalaj PWA
    }
    res.status(500).json({ ok: false, message: "Błąd tworzenia zamówienia" });
  }
});

// 5) pobierz zamówienia usera
app.get("/api/app/orders/:milkId", async (req, res) => {
  try {
    const milkId = fixedMilkId6(req.params.milkId);
    const list = await MilkOrder.find({ milkId }).sort({ createdAt: -1 }).limit(200);
    res.json({ ok: true, orders: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd pobierania zamówień" });
  }
});

// 6) utwórz kod nagrody (PWA “Wymień”)
app.post("/api/app/rewards/redeem", async (req, res) => {
  try {
    const { milkId, rewardId, rewardTitle, cost } = req.body || {};
    const id = fixedMilkId6(milkId);
    const c = Number(cost || 0);

    if (!id) return res.status(400).json({ ok: false, message: "Brak Milk ID" });
    if (!rewardTitle) return res.status(400).json({ ok: false, message: "Brak nagrody" });

    const user = await ensureMilkUser(id);
    if ((user.points || 0) < c) {
      return res.status(400).json({ ok: false, message: "Za mało punktów" });
    }

    user.points = Number(user.points || 0) - c;
    await user.save();

    // unikalny kod
    let code = makeCode();
    // w razie kolizji
    for (let i = 0; i < 5; i++) {
      const exists = await MilkCode.findOne({ code });
      if (!exists) break;
      code = makeCode();
    }

    const doc = await MilkCode.create({
      code,
      milkId: id,
      rewardId: String(rewardId || ""),
      rewardTitle: String(rewardTitle || ""),
      status: "pending",
    });

    await MilkHistory.create({
      milkId: id,
      type: "reward",
      detail: `Wymieniono -${c} pkt: ${rewardTitle} (kod: ${doc.code})`,
    });

    io.emit("milk:reward-issued", { milkId: id, code: doc.code, rewardTitle: doc.rewardTitle });
    res.json({ ok: true, code: doc.code, points: user.points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Błąd realizacji nagrody" });
  }
});

// ==========================
//  ROUTES (CLEAN URLS)
// ==========================

// clean: /admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

// clean: /menu
app.get("/menu", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "menu.html"));
});

// clean: /app (PWA)
app.get("/app", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "app.html"));
});

// clean: /appadmin (panel aplikacji)
app.get("/appadmin", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "appadmin.html"));
});

// przekierowania *.html -> clean URL
app.get("/menu.html", (req, res) => res.redirect(301, "/menu"));
app.get("/admin.html", (req, res) => res.redirect(301, "/admin"));
app.get("/app.html", (req, res) => res.redirect(301, "/app"));
app.get("/appadmin.html", (req, res) => res.redirect(301, "/appadmin"));
app.get("/index.html", (req, res) => res.redirect(301, "/"));

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "favicon.ico"));
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ==========================
//  START
// ==========================
server.listen(PORT, () => {
  console.log("MilkShake Bar server running on port:", PORT);
});

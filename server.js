// server.js — MilkShake Bar backend (Express + Socket.IO + MongoDB)
// OBSŁUGUJE: index.html + admin.html + menu.html + aplikacja.html + app.html + appadmin.html

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

// Root katalog (pliki luzem w repo)
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
//  MODELS (Twoje istniejące)
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

// Pracownicy
const EmployeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  pin: { type: String, required: true, unique: true }, // 4 cyfry
  role: { type: String, enum: ["manager", "employee"], default: "employee" },
  createdAt: { type: Date, default: Date.now },
});

const Product = mongoose.model("Product", ProductSchema);
const Reservation = mongoose.model("Reservation", ReservationSchema);
const HappyBar = mongoose.model("HappyBar", HappySchema);
const Employee = mongoose.model("Employee", EmployeeSchema);

// ==========================
//  NOWE MODELE dla appadmin.html (/api/admin/*)
// ==========================

// Użytkownicy aplikacji (panel: Klienci)
const AppUserSchema = new mongoose.Schema({
  milkId: { type: String, required: true, unique: true }, // np. 6 cyfr lub dowolne
  email: { type: String, default: "" },
  name: { type: String, default: "" },
  phone: { type: String, default: "" },
  points: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Zamówienia "Zamów i odbierz" (panel: Orders)
const AppOrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // UUID/string
  milkId: { type: String, required: true },
  items: {
    type: [
      {
        title: String,
        qty: Number,
        price: Number,
      },
    ],
    default: [],
  },
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

// Kody do realizacji (panel: Redeem + tabela kodów)
const AppCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true }, // np. MSB-AB12CD
  milkId: { type: String, required: true },
  rewardTitle: { type: String, default: "" },
  status: { type: String, default: "pending", enum: ["pending", "redeemed"] },
  createdAt: { type: Date, default: Date.now },
  redeemedAt: { type: Date, default: null },
});

// Historia użytkownika (panel: szczegóły klienta)
const AppHistorySchema = new mongoose.Schema({
  milkId: { type: String, required: true, index: true },
  ts: { type: Date, default: Date.now },
  type: { type: String, default: "action" }, // "points" | "order" | "code" | "reward" | ...
  detail: { type: String, default: "" },
});

const AppUser = mongoose.model("AppUser", AppUserSchema);
const AppOrder = mongoose.model("AppOrder", AppOrderSchema);
const AppCode = mongoose.model("AppCode", AppCodeSchema);
const AppHistory = mongoose.model("AppHistory", AppHistorySchema);

// ==========================
//  BASIC EXPRESS CONFIG
// ==========================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// statyczne pliki z root repo
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
    const fixedPin = String(pin || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);

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
    const fixedPin = String(pin || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
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
//  HELPERY dla appadmin (/api/admin/*)
// ==========================
function calcPoints(amountPLN) {
  const amt = Number(String(amountPLN || "").replace(",", "."));
  if (!isFinite(amt) || amt <= 0) return 0;
  return Math.floor(amt / 10); // 10 zł = 1 pkt
}
function normalizeMilkId(milkId) {
  return String(milkId || "").trim();
}

// ==========================
//  API: ADMIN (dla appadmin.html)
// ==========================

// stats: { users, totalPoints, totalOrders, pendingCodes }
app.get("/api/admin/stats", async (req, res) => {
  try {
    const usersCount = await AppUser.countDocuments();
    const ordersCount = await AppOrder.countDocuments();
    const pendingCodes = await AppCode.countDocuments({ status: "pending" });

    const agg = await AppUser.aggregate([
      { $group: { _id: null, totalPoints: { $sum: "$points" } } },
    ]);
    const totalPoints = agg?.[0]?.totalPoints || 0;

    res.json({
      users: usersCount,
      totalPoints,
      totalOrders: ordersCount,
      pendingCodes,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd statystyk" });
  }
});

// lista użytkowników
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
    res.status(500).json({ message: "Błąd klientów" });
  }
});

// historia użytkownika
app.get("/api/admin/users/:milkId/history", async (req, res) => {
  try {
    const milkId = normalizeMilkId(req.params.milkId);
    const hist = await AppHistory.find({ milkId }).sort({ ts: -1 }).limit(200);
    res.json(
      hist.map((h) => ({
        ts: h.ts,
        type: h.type,
        detail: h.detail,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd historii" });
  }
});

// zamówienia
app.get("/api/admin/orders", async (req, res) => {
  try {
    const orders = await AppOrder.find().sort({ createdAt: -1 });
    res.json(
      orders.map((o) => ({
        id: o.id,
        milkId: o.milkId,
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
    res.status(500).json({ message: "Błąd zamówień" });
  }
});

// kody
app.get("/api/admin/codes", async (req, res) => {
  try {
    const codes = await AppCode.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json(
      codes.map((c) => ({
        code: c.code,
        milkId: c.milkId,
        rewardTitle: c.rewardTitle || "",
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd kodów" });
  }
});

// dodaj punkty (10zł=1pkt) + tworzy usera jeśli nie istnieje
app.post("/api/admin/add-points", async (req, res) => {
  try {
    const { milkId, amountPLN } = req.body || {};
    const id = normalizeMilkId(milkId);
    const pts = calcPoints(amountPLN);

    if (!id) return res.status(400).json({ message: "Brak Milk ID" });
    if (pts <= 0) return res.status(400).json({ message: "Kwota za mała (0 pkt)" });

    let user = await AppUser.findOne({ milkId: id });
    if (!user) {
      user = await AppUser.create({ milkId: id, points: 0 });
    }

    user.points = Number(user.points || 0) + pts;
    await user.save();

    await AppHistory.create({
      milkId: id,
      type: "points",
      detail: `Dodano +${pts} pkt (kwota: ${String(amountPLN).replace(",", ".")} PLN)`,
    });

    res.json({ ok: true, points: pts, milkId: id, newTotal: user.points });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd dodawania punktów" });
  }
});

// sprawdź kod
app.post("/api/admin/codes/check", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = String(code || "").trim();
    if (!c) return res.status(400).json({ message: "Brak kodu" });

    const doc = await AppCode.findOne({ code: c });
    if (!doc || doc.status !== "pending") return res.status(400).json({ message: "Kod nieprawidłowy" });

    res.json({
      code: doc.code,
      milkId: doc.milkId,
      rewardTitle: doc.rewardTitle || "",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Kod nieprawidłowy" });
  }
});

// zrealizuj kod
app.post("/api/admin/codes/redeem", async (req, res) => {
  try {
    const { code } = req.body || {};
    const c = String(code || "").trim();
    if (!c) return res.status(400).json({ message: "Brak kodu" });

    const doc = await AppCode.findOne({ code: c });
    if (!doc || doc.status !== "pending") return res.status(400).json({ message: "Nie udało się zrealizować kodu" });

    doc.status = "redeemed";
    doc.redeemedAt = new Date();
    await doc.save();

    await AppHistory.create({
      milkId: doc.milkId,
      type: "code",
      detail: `Zrealizowano kod: ${doc.code}${doc.rewardTitle ? ` (${doc.rewardTitle})` : ""}`,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Nie udało się zrealizować kodu" });
  }
});

// ==========================
//  ROUTES (CLEAN URLS)
// ==========================

// home: /
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// clean: /admin
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));

// clean: /menu
app.get("/menu", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "menu.html")));

// clean: /aplikacja
app.get("/aplikacja", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "aplikacja.html")));

// clean: /app (PWA)
app.get("/app", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "app.html")));

// clean: /appadmin (panel aplikacji)
app.get("/appadmin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "appadmin.html")));

// przekierowania *.html → clean
app.get("/menu.html", (req, res) => res.redirect(301, "/menu"));
app.get("/admin.html", (req, res) => res.redirect(301, "/admin"));
app.get("/aplikacja.html", (req, res) => res.redirect(301, "/aplikacja"));
app.get("/app.html", (req, res) => res.redirect(301, "/app"));
app.get("/appadmin.html", (req, res) => res.redirect(301, "/appadmin"));
app.get("/index.html", (req, res) => res.redirect(301, "/"));

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "favicon.ico"));
});

// ==========================
//  SPA fallback
//  UWAGA: musi być na samym końcu,
//  ale dzięki dodanym /api/admin/* już nie łapie API.
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

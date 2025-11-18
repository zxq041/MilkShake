// server.js
// Backend dla MilkShake Bar (rezerwacje + menu + happy hour)

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ŚCIEŻKI DO PLIKÓW Z DANYMI =====
const DATA_DIR = path.join(__dirname, "data");
const RES_FILE = path.join(DATA_DIR, "reservations.json");
const MENU_FILE = path.join(DATA_DIR, "menu.json");
const HAPPY_FILE = path.join(DATA_DIR, "happy.json");

// prosta wersja plikowa – na Railway dane mogą znikać po redeployu
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error("Błąd readJson", filePath, err);
    return fallback;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Błąd writeJson", filePath, err);
  }
}

// ===== MIDDLEWARE =====
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ===== STATYCZNE PLIKI (wszystko w jednym folderze) =====
const PUBLIC_DIR = __dirname;

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// prosty CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ====== REZERWACJE ======

// tworzenie rezerwacji z index.html
app.post("/api/rezerwacje", (req, res) => {
  const {
    selected_seat_display,
    selected_seat_value,
    name,
    phone,
    date,
    time,
    guests,
  } = req.body || {};

  if (!selected_seat_value || !name || !phone || !date || !time || !guests) {
    return res
      .status(400)
      .json({ message: "Brak wymaganych pól w rezerwacji." });
  }

  const reservations = readJson(RES_FILE, []);

  const newReservation = {
    id: Date.now().toString(),
    seatName: selected_seat_display || "",
    seatId: selected_seat_value,
    name,
    phone,
    date,
    time,
    guests: Number(guests),
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  reservations.push(newReservation);
  writeJson(RES_FILE, reservations);

  return res.status(201).json(newReservation);
});

// lista rezerwacji do panelu
app.get("/api/rezerwacje", (req, res) => {
  const { status } = req.query;
  let reservations = readJson(RES_FILE, []);

  if (status && ["pending", "confirmed", "cancelled"].includes(status)) {
    reservations = reservations.filter((r) => r.status === status);
  }

  reservations.sort((a, b) =>
    (b.date + b.time).localeCompare(a.date + a.time)
  );

  res.json(reservations);
});

// zmiana statusu (przyjęcie / odrzucenie)
app.patch("/api/admin/rezerwacje/:id", (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!["pending", "confirmed", "cancelled"].includes(status)) {
    return res.status(400).json({ message: "Nieprawidłowy status." });
  }

  const reservations = readJson(RES_FILE, []);
  const idx = reservations.findIndex((r) => r.id === id);

  if (idx === -1) {
    return res.status(404).json({ message: "Rezerwacja nie istnieje." });
  }

  reservations[idx].status = status;
  reservations[idx].updatedAt = new Date().toISOString();

  writeJson(RES_FILE, reservations);
  res.json(reservations[idx]);
});

// USUWANIE rezerwacji
app.delete("/api/admin/rezerwacje/:id", (req, res) => {
  const { id } = req.params;
  const reservations = readJson(RES_FILE, []);
  const idx = reservations.findIndex((r) => r.id === id);

  if (idx === -1) {
    return res.status(404).json({ message: "Rezerwacja nie istnieje." });
  }

  const deleted = reservations[idx];
  reservations.splice(idx, 1);
  writeJson(RES_FILE, reservations);

  res.json({ success: true, deleted });
});

// ====== MENU ======

app.get("/api/menu", (req, res) => {
  const menu = readJson(MENU_FILE, []);
  res.json(menu);
});

app.post("/api/admin/menu", (req, res) => {
  const { name, price, category, description, imageData } = req.body || {};

  if (!name || typeof price === "undefined") {
    return res.status(400).json({ message: "Nazwa i cena są wymagane." });
  }

  const menu = readJson(MENU_FILE, []);

  const newItem = {
    id: Date.now().toString(),
    name,
    price: Number(price),
    category: category || "",
    description: description || "",
    imageData: imageData || "",
    createdAt: new Date().toISOString(),
  };

  menu.push(newItem);
  writeJson(MENU_FILE, menu);

  res.status(201).json(newItem);
});

app.put("/api/admin/menu/:id", (req, res) => {
  const { id } = req.params;
  const { name, price, category, description, imageData } = req.body || {};

  const menu = readJson(MENU_FILE, []);
  const idx = menu.findIndex((m) => m.id === id);

  if (idx === -1) {
    return res.status(404).json({ message: "Pozycja nie istnieje." });
  }

  if (!name || typeof price === "undefined") {
    return res.status(400).json({ message: "Nazwa i cena są wymagane." });
  }

  menu[idx] = {
    ...menu[idx],
    name,
    price: Number(price),
    category: category || "",
    description: description || "",
    imageData: imageData || menu[idx].imageData || "",
    updatedAt: new Date().toISOString(),
  };

  writeJson(MENU_FILE, menu);
  res.json(menu[idx]);
});

app.delete("/api/admin/menu/:id", (req, res) => {
  const { id } = req.params;
  const menu = readJson(MENU_FILE, []);
  const idx = menu.findIndex((m) => m.id === id);

  if (idx === -1) {
    return res.status(404).json({ message: "Pozycja nie istnieje." });
  }

  const deleted = menu[idx];
  menu.splice(idx, 1);
  writeJson(MENU_FILE, menu);

  res.json({ success: true, deleted });
});

// ====== HAPPY HOUR ======

app.get("/api/settings/happy-hour", (req, res) => {
  const happy = readJson(HAPPY_FILE, {
    text: "",
    enabled: false,
    link: "",
  });
  res.json(happy);
});

app.put("/api/admin/settings/happy-hour", (req, res) => {
  const { text, enabled, link } = req.body || {};

  const happy = {
    text: text || "",
    enabled: !!enabled,
    link: link || "",
    updatedAt: new Date().toISOString(),
  };

  writeJson(HAPPY_FILE, happy);
  res.json(happy);
});

// ===== START SERWERA =====
app.listen(PORT, () => {
  console.log(`MilkShake Bar backend działa na porcie ${PORT}`);
});
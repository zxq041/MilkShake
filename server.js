// server.js (BEZ ZMIAN)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PUBLIC_DIR = __dirname;
const DB_FILE = path.join(__dirname, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ---------------------------
// Multer storage
// ---------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg');
    const name = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

// ---------------------------
// App + Socket
// ---------------------------
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// static
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------------------------
// Simple file-backed DB
// ---------------------------
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const init = { reservations: [], products: [], happy: '' };
      fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
      return init;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const data = JSON.parse(raw);

    data.reservations ||= [];
    data.products ||= [];
    data.happy ||= "";

    return data;
  } catch (err) {
    console.error('Failed to read DB file:', err);
    return { reservations: [], products: [], happy: '' };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------------------------
// API
// ---------------------------

// GET full data (admin + menu)
app.get('/api/data', (req, res) => {
  const db = readDB();
  res.json(db);
});

// MENU PRODUCTS
app.get('/api/products', (req, res) => {
  const db = readDB();
  res.json(db.products || []);
});

// add product (multipart/form-data)
app.post('/api/products/add', upload.single('image'), (req, res) => {
  try {
    const db = readDB();
    const body = req.body || {};

    if (!body.title || !body.category) {
      return res.status(400).json({ message: "Brakuje title albo category" });
    }

    const newProduct = {
      id: Date.now().toString(),
      title: String(body.title),
      price: Number(body.price || 0),
      description: String(body.description || ""),
      tag: String(body.tag || ""),
      category: String(body.category),
      image: req.file ? `/uploads/${req.file.filename}` : (body.imageUrl || ""),
      created: new Date().toISOString()
    };

    db.products.unshift(newProduct);
    writeDB(db);

    io.emit('state:update', db);
    return res.status(201).json({ ok: true, product: newProduct });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Błąd serwera" });
  }
});

// update whole products list (admin sync)
app.post('/api/products', (req, res) => {
  try {
    const db = readDB();
    db.products = req.body.products || [];
    writeDB(db);
    io.emit('state:update', db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'error' });
  }
});

// Happy hour
app.post('/api/happy', (req, res) => {
  try {
    const db = readDB();
    db.happy = req.body.happy || '';
    writeDB(db);
    io.emit('state:update', db);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'error' });
  }
});

// RESERVATIONS
app.get('/api/rezerwacje', (req, res) => {
  const db = readDB();
  res.json(db.reservations || []);
});

app.post('/api/rezerwacje', (req, res) => {
  try {
    const db = readDB();
    const payload = req.body || {};

    if (!payload.name || !payload.phone || !payload.date || !payload.time) {
      return res.status(400).json({
        message: 'Brakuje wymaganych pól: name, phone, date, time'
      });
    }

    const newRes = {
      id: Date.now().toString(),
      name: String(payload.name),
      phone: String(payload.phone),
      date: String(payload.date),
      time: String(payload.time),
      guests: payload.guests || payload.persons || payload.people || 2,
      room: payload.room || payload.zone || 'Sala główna',
      notes: payload.notes || '',
      status: 'new',
      created: new Date().toISOString()
    };

    db.reservations.push(newRes);
    writeDB(db);

    io.emit('reservation:new', newRes);
    io.emit('state:update', db);

    return res.status(201).json({ ok: true, reservation: newRes });
  } catch (err) {
    console.error('Error saving reservation:', err);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  const db = readDB();
  socket.emit('state:init', db);

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Serving static files from ${PUBLIC_DIR}`);
});

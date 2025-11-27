// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PUBLIC_DIR = __dirname;
const DB_FILE = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || ".jpg";
    const safe = Date.now() + "-" + Math.random().toString(36).slice(2) + ext;
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const init = { reservations: [], products: [], happy: '' };
      fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
      return init;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to read DB file:', err);
    return { reservations: [], products: [], happy: '' };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// API: full data
app.get('/api/data', (req, res) => {
  res.json(readDB());
});

// API: list reservations
app.get('/api/rezerwacje', (req, res) => {
  const db = readDB();
  res.json(db.reservations || []);
});

// API: create reservation
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

    db.reservations = db.reservations || [];
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

// UPLOAD IMAGE
app.post('/api/upload', upload.single('image'), (req, res) => {
  try{
    if(!req.file) return res.status(400).json({ message:"Brak pliku" });
    const url = "/uploads/" + req.file.filename;
    res.json({ ok:true, url });
  }catch(e){
    res.status(500).json({ message:"Upload error" });
  }
});

// PRODUCTS sync
app.post('/api/products', (req, res) => {
  try {
    const db = readDB();
    db.products = req.body.products || [];
    writeDB(db);
    io.emit('state:update', db);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'error' });
  }
});

// HAPPY sync
app.post('/api/happy', (req, res) => {
  try {
    const db = readDB();
    db.happy = req.body.happy || '';
    writeDB(db);
    io.emit('state:update', db);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'error' });
  }
});

// Socket.IO handlers
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.emit('state:init', readDB());
  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});

// fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Serving static files from ${PUBLIC_DIR}`);
});

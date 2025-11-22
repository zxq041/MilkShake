// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(__dirname, 'db.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (index.html, admin.html etc.)
app.use(express.static(PUBLIC_DIR));

// Simple file-backed DB
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

// API: get full data
app.get('/api/data', (req, res) => {
  const db = readDB();
  res.json(db);
});

// API: list reservations
app.get('/api/rezerwacje', (req, res) => {
  const db = readDB();
  res.json(db.reservations || []);
});

// API: create reservation (index.html posts here)
app.post('/api/rezerwacje', (req, res) => {
  try {
    const db = readDB();
    const payload = req.body || {};

    // Basic normalization/validation
    if (!payload.name || !payload.phone || !payload.date || !payload.time) {
      return res.status(400).json({ message: 'Brakuje wymaganych pól: name, phone, date, time' });
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

    // Emit via WebSocket so admin sees it immediately
    io.emit('reservation:new', newRes);

    // Also emit full state update optionally:
    io.emit('state:update', db);

    return res.status(201).json({ ok: true, reservation: newRes });
  } catch (err) {
    console.error('Error saving reservation:', err);
    return res.status(500).json({ message: 'Błąd serwera' });
  }
});

// Optional endpoints to sync products/happy hour from admin panel (if needed)
app.post('/api/products', (req, res) => {
  try {
    const db = readDB();
    db.products = req.body.products || db.products || [];
    writeDB(db);
    io.emit('state:update', db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: 'error' }); }
});
app.post('/api/happy', (req, res) => {
  try {
    const db = readDB();
    db.happy = req.body.happy || '';
    writeDB(db);
    io.emit('state:update', db);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: 'error' }); }
});

// Socket.IO handlers (mainly for broadcasting)
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // On new connection, optionally send full state
  const db = readDB();
  socket.emit('state:init', db);

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
  console.log(`Serving static files from ${PUBLIC_DIR}`);
});

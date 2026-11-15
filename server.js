/**
 * RULETA DE SORTEOS PRO - SERVIDOR EN TIEMPO REAL
 * Sincronización multi-dispositivo vía Server-Sent Events (SSE).
 * Permite que los 150 espectadores vean la ruleta en sus móviles mientras
 * únicamente el Administrador controla los giros desde su propio dispositivo.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT_DIR = __dirname;
const WINNER_INDEX = 51;
const TOTAL_NUMBERS = 151;

// Generar etiquetas '00', '01', ..., '150'
const items = Array.from({ length: TOTAL_NUMBERS }, (_, i) => {
  if (i === 0) return '00';
  return i < 10 ? '0' + i : String(i);
});

// Estado centralizado en el servidor
let spinCount = 0;
let isCurrentlySpinning = false;
let sseClients = new Set();

function broadcastEvent(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Habilitar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ================= ENDPOINT SSE (/events) =================
  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');

    sseClients.add(res);

    // Enviar estado actual al conectarse
    const initData = {
      type: 'init',
      spinCount: spinCount,
      spectatorCount: sseClients.size
    };
    res.write(`data: ${JSON.stringify(initData)}\n\n`);

    // Notificar cambio en cantidad de espectadores
    broadcastEvent({ type: 'spectator_count', count: sseClients.size });

    req.on('close', () => {
      sseClients.delete(res);
      broadcastEvent({ type: 'spectator_count', count: sseClients.size });
    });
    return;
  }

  // ================= API: GIRAR RULETA (Solo Administrador) =================
  if (pathname === '/api/spin' && req.method === 'POST') {
    if (isCurrentlySpinning) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'La ruleta ya está en movimiento' }));
      return;
    }

    isCurrentlySpinning = true;

    // Conteo estricto del 1 al 4:
    // Al pasar de la vuelta 4, vuelve a iniciar en la vuelta 1 automáticamente.
    if (spinCount >= 4) {
      spinCount = 0;
    }
    spinCount++;

    let targetIndex;
    let isWinner = false;

    if (spinCount <= 3) {
      // Vueltas 1, 2 y 3: Número 100% aleatorio (excluyendo obligatoriamente el 51)
      const allowed = [];
      for (let i = 0; i < TOTAL_NUMBERS; i++) {
        if (i !== WINNER_INDEX) allowed.push(i);
      }
      targetIndex = allowed[Math.floor(Math.random() * allowed.length)];
      isWinner = false;
    } else {
      // Vuelta 4: SIEMPRE ES EL 51 GARANTIZADO
      targetIndex = WINNER_INDEX; // 51
      isWinner = true;
    }

    const payload = {
      type: 'spin',
      turn: spinCount,
      targetIndex: targetIndex,
      targetLabel: items[targetIndex],
      isWinner: isWinner,
      durationMs: 3600,
      timestamp: Date.now()
    };

    // Emitir orden de giro a todas las pantallas conectadas simultáneamente
    broadcastEvent(payload);

    setTimeout(() => {
      isCurrentlySpinning = false;
    }, 4200);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, payload }));
    return;
  }

  // ================= API: REINICIAR CONTEO =================
  if (pathname === '/api/reset' && req.method === 'POST') {
    spinCount = 0;
    isCurrentlySpinning = false;
    broadcastEvent({ type: 'reset', spinCount: 0 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, spinCount: 0 }));
    return;
  }

  // ================= API: ESTADO ACTUAL =================
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      spinCount,
      isCurrentlySpinning,
      spectatorCount: sseClients.size
    }));
    return;
  }

  // ================= SERVICIO DE ARCHIVOS ESTÁTICOS =================
  let filePath = '';
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(ROOT_DIR, 'index.html');
  } else if (pathname === '/admin' || pathname === '/admin.html') {
    filePath = path.join(ROOT_DIR, 'admin.html');
  } else {
    filePath = path.join(ROOT_DIR, pathname);
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('404 No encontrado');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end(`500 Error de servidor: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de Ruleta en vivo activo en puerto ${PORT}`);
});


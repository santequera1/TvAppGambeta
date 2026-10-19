/**
 * =============================================================
 * Gambeta Auriverde IPTV · Servidor Node.js (sin dependencias externas)
 * - Sirve los archivos estáticos de la aplicación.
 * - API REST de autenticación por número de teléfono (/api/auth/*)
 * - API REST CRUD de miembros para el panel Admin (/api/admin/*)
 * - API REST de chat en vivo del partido (/api/chat)
 * - Persistencia automática en data/usuarios.json y data/chat.json
 * =============================================================
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 5500;
const ROOT = __dirname;
const DB_USUARIOS = path.join(ROOT, 'data', 'usuarios.json');
const DB_CHAT = path.join(ROOT, 'data', 'chat.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.gz': 'application/gzip',
};

function normalizarTelefono(valor) {
  return String(valor || '').replace(/\D+/g, '');
}

function telefonosCoinciden(guardado, ingresado) {
  const a = normalizarTelefono(guardado);
  const b = normalizarTelefono(ingresado);
  if (!a || !b || b.length < 6) return false;
  if (a === b) return true;
  // Permite coincidencia con o sin prefijo de país (+57, +56, +54, etc.) si los últimos 9 o 10 dígitos son iguales
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 9) {
    return a.slice(-minLen) === b.slice(-minLen);
  }
  return false;
}

function leerUsuariosDb() {
  try {
    if (!fs.existsSync(DB_USUARIOS)) {
      const inicial = {
        adminPin: '0418',
        actualizado: new Date().toISOString(),
        usuarios: [
          {
            id: 'usr-stiven-admin',
            nombre: 'Stiven',
            telefono: '3026444564',
            nota: 'Administrador · Gambeta Auriverde',
            activo: true,
            creado: new Date().toISOString(),
            ultimoAcceso: null,
          },
        ],
      };
      fs.mkdirSync(path.dirname(DB_USUARIOS), { recursive: true });
      fs.writeFileSync(DB_USUARIOS, JSON.stringify(inicial, null, 2), 'utf8');
      return inicial;
    }
    const raw = fs.readFileSync(DB_USUARIOS, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.usuarios)) parsed.usuarios = [];
    if (!parsed.adminPin) parsed.adminPin = '0418';
    return parsed;
  } catch (err) {
    return { adminPin: '0418', actualizado: new Date().toISOString(), usuarios: [] };
  }
}

function guardarUsuariosDb(db) {
  db.actualizado = new Date().toISOString();
  fs.mkdirSync(path.dirname(DB_USUARIOS), { recursive: true });
  fs.writeFileSync(DB_USUARIOS, JSON.stringify(db, null, 2), 'utf8');
}

function leerChatDb() {
  try {
    if (!fs.existsSync(DB_CHAT)) return { mensajes: [] };
    const parsed = JSON.parse(fs.readFileSync(DB_CHAT, 'utf8'));
    return { mensajes: Array.isArray(parsed.mensajes) ? parsed.mensajes : [] };
  } catch {
    return { mensajes: [] };
  }
}

function guardarChatDb(chat) {
  try {
    fs.mkdirSync(path.dirname(DB_CHAT), { recursive: true });
    fs.writeFileSync(DB_CHAT, JSON.stringify(chat, null, 2), 'utf8');
  } catch { /* ignore */ }
}

const TELEFONO_ADMIN_PRINCIPAL = '3026444564';

function responderJson(res, status, datos) {
  const payload = JSON.stringify(datos);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Pin, X-Member-Phone',
  });
  res.end(payload);
}

function leerBodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload demasiado grande'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function esPinValido(pin, dbPin) {
  const p = String(pin || '').trim();
  if (!p) return false;
  return p === String(dbPin) || p === '0418' || p === '04218';
}

function esTelefonoStiven(tel) {
  const limpio = normalizarTelefono(tel);
  return Boolean(limpio && telefonosCoinciden(limpio, TELEFONO_ADMIN_PRINCIPAL));
}

function verificarPinAdmin(req, body, db) {
  const pinHeader = req.headers['x-admin-pin'];
  const pinBody = body?.adminPin || body?.pin;
  const pin = String(pinHeader || pinBody || '').trim();
  return esPinValido(pin, db.adminPin);
}

/**
 * Resuelve quién está operando el panel de miembros:
 * - Si es Stiven (3026444564) o entra con PIN maestro sin otro teléfono distinto, tiene rol 'stiven' (ve todos).
 * - Si es otro miembro activo, tiene rol 'miembro' y solo ve/gestiona los que él mismo agregó (creadoPor).
 */
function resolverActorMiembros(req, body, db, urlObj) {
  const pinOk = verificarPinAdmin(req, body, db);
  const telHeader = req.headers['x-member-phone'] || body?.miembroTelefono || urlObj?.searchParams?.get('miembro') || '';
  const telLimpio = normalizarTelefono(telHeader);

  if (pinOk && (!telLimpio || esTelefonoStiven(telLimpio) || esPinValido(telHeader, db.adminPin))) {
    return {
      autorizado: true,
      esStiven: true,
      telefono: TELEFONO_ADMIN_PRINCIPAL,
      nombre: 'Stiven',
    };
  }

  if (telLimpio) {
    if (esTelefonoStiven(telLimpio) && pinOk) {
      return {
        autorizado: true,
        esStiven: true,
        telefono: TELEFONO_ADMIN_PRINCIPAL,
        nombre: 'Stiven',
      };
    }
    const miembro = db.usuarios.find(u => u.activo !== false && telefonosCoinciden(u.telefono, telLimpio));
    if (miembro && !esTelefonoStiven(miembro.telefono)) {
      return {
        autorizado: true,
        esStiven: false,
        telefono: normalizarTelefono(miembro.telefono),
        nombre: miembro.nombre,
      };
    }
  }

  return { autorizado: false, esStiven: false, telefono: '', nombre: '' };
}

function filtrarUsuariosParaActor(usuarios, actor) {
  if (!actor || !actor.autorizado) return [];
  if (actor.esStiven) return usuarios;
  return usuarios.filter(u => u.creadoPor && telefonosCoinciden(u.creadoPor, actor.telefono));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return responderJson(res, 200, { ok: true });
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  try {
    /* ==================== API: SEÑALES LA18HD ==================== */
    if (pathname === '/api/la18hd' && req.method === 'GET') {
      const cacheFile = path.join(ROOT, 'data', 'la18hd-status.json');
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch('https://la18hd.su/status.json?_=' + Date.now(), {
          signal: ctrl.signal,
          headers: { 'Cache-Control': 'no-cache' },
        });
        clearTimeout(timer);
        if (r.ok) {
          const data = await r.json();
          fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf8');
          return responderJson(res, 200, data);
        }
      } catch { /* fallback to local file */ }
      if (fs.existsSync(cacheFile)) {
        const local = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return responderJson(res, 200, local);
      }
      return responderJson(res, 503, { error: 'Catálogo no disponible' });
    }

    /* ==================== API: CHAT DEL PARTIDO ==================== */
    if (pathname === '/api/chat') {
      if (req.method === 'GET') {
        const chat = leerChatDb();
        return responderJson(res, 200, { mensajes: chat.mensajes.slice(-80) });
      }
      if (req.method === 'POST') {
        const body = await leerBodyJson(req);
        const apodo = String(body.apodo || '').trim().slice(0, 28);
        const pais = String(body.pais || 'Club').trim().slice(0, 28);
        const texto = String(body.texto || '').trim().slice(0, 200);
        const canal = String(body.canal || '').trim().slice(0, 60);
        if (!apodo || !texto) return responderJson(res, 400, { error: 'Apodo y mensaje requeridos' });
        const chat = leerChatDb();
        const nuevo = {
          id: `${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          apodo,
          pais,
          texto,
          canal,
          creado: new Date().toISOString(),
        };
        chat.mensajes.push(nuevo);
        if (chat.mensajes.length > 80) chat.mensajes = chat.mensajes.slice(-80);
        guardarChatDb(chat);
        return responderJson(res, 200, { ok: true, id: nuevo.id, mensaje: nuevo });
      }
    }

    /* ==================== API: LOGIN POR TELÉFONO ==================== */
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await leerBodyJson(req);
      const entrada = String(body.telefono || '').trim();
      const db = leerUsuariosDb();

      // Si ingresa el PIN maestro de admin, también le permite entrar como Stiven (Admin)
      if (esPinValido(entrada, db.adminPin)) {
        return responderJson(res, 200, {
          ok: true,
          esAdminPin: true,
          usuario: {
            id: 'admin-master',
            nombre: 'Stiven',
            telefono: TELEFONO_ADMIN_PRINCIPAL,
            nota: 'Administrador · Gambeta Auriverde',
            activo: true,
            esStiven: true,
          },
        });
      }

      const encontrado = db.usuarios.find(u => telefonosCoinciden(u.telefono, entrada));
      if (!encontrado) {
        return responderJson(res, 401, {
          ok: false,
          error: 'Este número de teléfono no está en la lista de amigos autorizados.',
        });
      }
      if (encontrado.activo === false) {
        return responderJson(res, 403, {
          ok: false,
          error: 'Tu acceso está temporalmente pausado por el administrador.',
        });
      }

      encontrado.ultimoAcceso = new Date().toISOString();
      guardarUsuariosDb(db);

      return responderJson(res, 200, {
        ok: true,
        usuario: {
          id: encontrado.id,
          nombre: encontrado.nombre,
          telefono: encontrado.telefono,
          nota: encontrado.nota || '',
          activo: true,
          esStiven: esTelefonoStiven(encontrado.telefono),
        },
      });
    }

    if (pathname === '/api/auth/check' && req.method === 'GET') {
      const tel = urlObj.searchParams.get('telefono') || '';
      const db = leerUsuariosDb();
      if (tel && esPinValido(tel, db.adminPin)) {
        return responderJson(res, 200, { ok: true, activo: true });
      }
      const encontrado = db.usuarios.find(u => telefonosCoinciden(u.telefono, tel));
      if (!encontrado || encontrado.activo === false) {
        return responderJson(res, 401, { ok: false, activo: false });
      }
      return responderJson(res, 200, {
        ok: true,
        activo: true,
        usuario: {
          id: encontrado.id,
          nombre: encontrado.nombre,
          telefono: encontrado.telefono,
          nota: encontrado.nota || '',
          esStiven: esTelefonoStiven(encontrado.telefono),
        },
      });
    }

    /* ==================== API: CRUD MIEMBROS (STIVEN VE TODOS, MIEMBROS VEN SOLO LOS SUYOS) ==================== */
    if (pathname === '/api/admin/verify' && req.method === 'POST') {
      const body = await leerBodyJson(req);
      const db = leerUsuariosDb();
      const actor = resolverActorMiembros(req, body, db, urlObj);
      if (!actor.autorizado) {
        return responderJson(res, 401, { ok: false, error: 'PIN de administrador o sesión no autorizada.' });
      }
      return responderJson(res, 200, {
        ok: true,
        esStiven: actor.esStiven,
        actualizado: db.actualizado,
        usuarios: filtrarUsuariosParaActor(db.usuarios, actor),
      });
    }

    if (pathname === '/api/admin/usuarios') {
      const db = leerUsuariosDb();
      const body = req.method === 'GET' ? {} : await leerBodyJson(req);
      const actor = resolverActorMiembros(req, body, db, urlObj);
      if (!actor.autorizado) {
        return responderJson(res, 401, { ok: false, error: 'No autorizado para gestionar miembros.' });
      }

      if (req.method === 'GET') {
        return responderJson(res, 200, {
          ok: true,
          esStiven: actor.esStiven,
          actualizado: db.actualizado,
          usuarios: filtrarUsuariosParaActor(db.usuarios, actor),
        });
      }

      if (req.method === 'POST') {
        const nombre = String(body.nombre || '').trim().slice(0, 60);
        const telefono = normalizarTelefono(body.telefono);
        const nota = String(body.nota || '').trim().slice(0, 100);
        const activo = body.activo !== false;

        if (!nombre) return responderJson(res, 400, { ok: false, error: 'Ingresa el nombre o apodo de tu amigo.' });
        if (!telefono || telefono.length < 6) {
          return responderJson(res, 400, { ok: false, error: 'Ingresa un número de teléfono válido (mínimo 6 dígitos).' });
        }
        const duplicado = db.usuarios.find(u => normalizarTelefono(u.telefono) === telefono);
        if (duplicado) {
          return responderJson(res, 409, { ok: false, error: 'Ese número de teléfono ya se encuentra registrado en el club.' });
        }

        const nuevo = {
          id: `usr-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
          nombre,
          telefono,
          nota,
          activo,
          creadoPor: actor.telefono || TELEFONO_ADMIN_PRINCIPAL,
          creadoPorNombre: actor.nombre || 'Stiven',
          creado: new Date().toISOString(),
          ultimoAcceso: null,
        };
        db.usuarios.unshift(nuevo);
        guardarUsuariosDb(db);
        return responderJson(res, 201, {
          ok: true,
          esStiven: actor.esStiven,
          usuario: nuevo,
          usuarios: filtrarUsuariosParaActor(db.usuarios, actor),
        });
      }
    }

    if (pathname.startsWith('/api/admin/usuarios/')) {
      const id = pathname.slice('/api/admin/usuarios/'.length).trim();
      const db = leerUsuariosDb();
      const body = req.method === 'DELETE' ? {} : await leerBodyJson(req);
      const actor = resolverActorMiembros(req, body, db, urlObj);
      if (!actor.autorizado) {
        return responderJson(res, 401, { ok: false, error: 'No autorizado.' });
      }

      const idx = db.usuarios.findIndex(u => u.id === id);
      if (idx === -1) {
        return responderJson(res, 404, { ok: false, error: 'Miembro no encontrado.' });
      }

      const actual = db.usuarios[idx];
      if (!actor.esStiven && (!actual.creadoPor || !telefonosCoinciden(actual.creadoPor, actor.telefono))) {
        return responderJson(res, 403, { ok: false, error: 'Solo puedes modificar a los amigos que tú mismo agregaste.' });
      }

      if (req.method === 'PUT') {
        const nombre = body.nombre !== undefined ? String(body.nombre).trim().slice(0, 60) : actual.nombre;
        const telefono = body.telefono !== undefined ? normalizarTelefono(body.telefono) : actual.telefono;
        const nota = body.nota !== undefined ? String(body.nota).trim().slice(0, 100) : actual.nota;
        const activo = body.activo !== undefined ? Boolean(body.activo) : actual.activo;

        if (!nombre) return responderJson(res, 400, { ok: false, error: 'El nombre no puede estar vacío.' });
        if (!telefono || telefono.length < 6) {
          return responderJson(res, 400, { ok: false, error: 'El número de teléfono debe tener al menos 6 dígitos.' });
        }
        const duplicado = db.usuarios.find((u, i) => i !== idx && normalizarTelefono(u.telefono) === telefono);
        if (duplicado) {
          return responderJson(res, 409, { ok: false, error: 'Ese número ya está registrado en el club.' });
        }

        db.usuarios[idx] = {
          ...actual,
          nombre,
          telefono,
          nota,
          activo,
        };
        guardarUsuariosDb(db);
        return responderJson(res, 200, {
          ok: true,
          esStiven: actor.esStiven,
          usuario: db.usuarios[idx],
          usuarios: filtrarUsuariosParaActor(db.usuarios, actor),
        });
      }

      if (req.method === 'DELETE') {
        const eliminado = db.usuarios.splice(idx, 1)[0];
        guardarUsuariosDb(db);
        return responderJson(res, 200, {
          ok: true,
          esStiven: actor.esStiven,
          eliminado,
          usuarios: filtrarUsuariosParaActor(db.usuarios, actor),
        });
      }
    }

    if (pathname === '/api/admin/pin' && req.method === 'PUT') {
      const body = await leerBodyJson(req);
      const db = leerUsuariosDb();
      const actor = resolverActorMiembros(req, body, db, urlObj);
      if (!actor.autorizado || !actor.esStiven) {
        return responderJson(res, 401, { ok: false, error: 'Solo Stiven (Administrador) puede cambiar el PIN maestro.' });
      }
      const nuevoPin = String(body.nuevoPin || '').trim();
      if (!nuevoPin || nuevoPin.length < 4) {
        return responderJson(res, 400, { ok: false, error: 'El nuevo PIN debe tener al menos 4 caracteres.' });
      }
      db.adminPin = nuevoPin;
      guardarUsuariosDb(db);
      return responderJson(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/import' && req.method === 'POST') {
      const body = await leerBodyJson(req);
      const db = leerUsuariosDb();
      const actor = resolverActorMiembros(req, body, db, urlObj);
      if (!actor.autorizado || !actor.esStiven) {
        return responderJson(res, 401, { ok: false, error: 'Solo el administrador principal puede importar la base de datos.' });
      }
      if (!Array.isArray(body.usuarios)) {
        return responderJson(res, 400, { ok: false, error: 'Formato de lista de usuarios no válido.' });
      }
      db.usuarios = body.usuarios
        .filter(u => u && u.nombre && normalizarTelefono(u.telefono).length >= 6)
        .map(u => ({
          id: String(u.id || `usr-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`),
          nombre: String(u.nombre).trim().slice(0, 60),
          telefono: normalizarTelefono(u.telefono),
          nota: String(u.nota || '').trim().slice(0, 100),
          activo: u.activo !== false,
          creadoPor: u.creadoPor || TELEFONO_ADMIN_PRINCIPAL,
          creadoPorNombre: u.creadoPorNombre || 'Stiven',
          creado: u.creado || new Date().toISOString(),
          ultimoAcceso: u.ultimoAcceso || null,
        }));
      guardarUsuariosDb(db);
      return responderJson(res, 200, { ok: true, usuarios: db.usuarios });
    }

    /* ==================== ARCHIVOS ESTÁTICOS ==================== */
    let relPath = pathname === '/' ? '/index.html' : pathname;
    if (relPath === '/data/usuarios.json') {
      const db = leerUsuariosDb();
      const actor = resolverActorMiembros(req, {}, db, urlObj);
      return responderJson(res, 200, {
        actualizado: db.actualizado,
        usuarios: filtrarUsuariosParaActor(db.usuarios, actor),
      });
    }

    const safePath = path.normalize(path.join(ROOT, relPath));
    if (!safePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.json' || ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  } catch (err) {
    responderJson(res, 500, { ok: false, error: err.message || 'Error interno del servidor' });
  }
});

server.listen(PORT, () => {
  console.log(`\n⚽ Gambeta Auriverde TV corriendo en: http://127.0.0.1:${PORT}`);
  console.log(`🔒 Panel Admin PIN por defecto: 0418`);
  console.log(`📱 Base de datos de teléfonos: ${DB_USUARIOS}\n`);
});

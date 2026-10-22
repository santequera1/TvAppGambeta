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
const { Readable } = require('stream');

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
    if (!Array.isArray(parsed.historialAccesos)) parsed.historialAccesos = [];
    if (!parsed.adminPin) parsed.adminPin = '0418';
    return parsed;
  } catch (err) {
    return { adminPin: '0418', actualizado: new Date().toISOString(), usuarios: [], historialAccesos: [] };
  }
}

function guardarUsuariosDb(db) {
  db.actualizado = new Date().toISOString();
  fs.mkdirSync(path.dirname(DB_USUARIOS), { recursive: true });
  fs.writeFileSync(DB_USUARIOS, JSON.stringify(db, null, 2), 'utf8');
}

function leerChatDb() {
  try {
    if (!fs.existsSync(DB_CHAT)) return { mensajes: [], encuesta: null };
    const parsed = JSON.parse(fs.readFileSync(DB_CHAT, 'utf8'));
    return {
      mensajes: Array.isArray(parsed.mensajes) ? parsed.mensajes : [],
      encuesta: parsed.encuesta && typeof parsed.encuesta === 'object' ? parsed.encuesta : null,
    };
  } catch {
    return { mensajes: [], encuesta: null };
  }
}

function guardarChatDb(chat) {
  try {
    fs.mkdirSync(path.dirname(DB_CHAT), { recursive: true });
    fs.writeFileSync(DB_CHAT, JSON.stringify(chat, null, 2), 'utf8');
  } catch { /* ignore */ }
}

const TELEFONO_ADMIN_PRINCIPAL = '3026444564';
const VENTANA_ONLINE_MS = 75 * 1000; // 75s para considerar conectado en tiempo real

function obtenerIpCliente(req) {
  const candidatos = [
    req.headers['cf-connecting-ip'],
    req.headers['x-real-ip'],
    req.headers['x-forwarded-for'],
    req.socket?.remoteAddress,
  ];
  for (const raw of candidatos) {
    if (!raw) continue;
    const primera = String(raw).split(',')[0].trim();
    if (!primera) continue;
    const limpia = primera.replace(/^::ffff:/i, '');
    if (limpia === '::1') return '127.0.0.1';
    return limpia;
  }
  return 'Desconocida';
}

function detectarDispositivo(uaRaw) {
  const ua = String(uaRaw || '');
  if (!ua) return 'Navegador Web';
  let so = 'Web';
  if (/SmartTV|Tizen|Web0S|NetCast|BRAVIA|AFT/i.test(ua)) so = 'Smart TV';
  else if (/iPhone/i.test(ua)) so = 'iPhone';
  else if (/iPad/i.test(ua)) so = 'iPad';
  else if (/Android/i.test(ua)) so = 'Android';
  else if (/Windows/i.test(ua)) so = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) so = 'Mac';
  else if (/Linux/i.test(ua)) so = 'Linux';

  let nav = '';
  if (/Edg\//i.test(ua)) nav = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) nav = 'Opera';
  else if (/CriOS|Chrome\//i.test(ua) && !/Edg\//i.test(ua)) nav = 'Chrome';
  else if (/FxiOS|Firefox\//i.test(ua)) nav = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) nav = 'Safari';

  return nav ? `${so} · ${nav}` : so;
}

function registrarActividadUsuario(db, usuario, req, opciones = {}) {
  if (!usuario) return;
  const ahoraIso = new Date().toISOString();
  const ahoraMs = Date.now();
  const ip = obtenerIpCliente(req);
  const dispositivo = detectarDispositivo(req.headers['user-agent']);
  const canal = opciones.canal !== undefined ? String(opciones.canal || '').trim().slice(0, 70) : undefined;

  if (opciones.esHeartbeat && usuario.ultimoHeartbeat) {
    const prevMs = Date.parse(usuario.ultimoHeartbeat);
    if (!Number.isNaN(prevMs)) {
      const deltaSeg = Math.round((ahoraMs - prevMs) / 1000);
      if (deltaSeg >= 3 && deltaSeg <= 95) {
        usuario.tiempoOnlineSegundos = (Number(usuario.tiempoOnlineSegundos) || 0) + deltaSeg;
      }
    }
  }

  if (opciones.esLogin) {
    usuario.sesionesCount = (Number(usuario.sesionesCount) || 0) + 1;
    if (!Array.isArray(db.historialAccesos)) db.historialAccesos = [];
    db.historialAccesos.unshift({
      id: `acc-${ahoraMs.toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
      usuarioId: usuario.id,
      nombre: usuario.nombre,
      telefono: usuario.telefono,
      ip,
      dispositivo,
      fecha: ahoraIso,
      tipo: 'ingreso',
    });
    if (db.historialAccesos.length > 100) {
      db.historialAccesos = db.historialAccesos.slice(0, 100);
    }
  }

  if (opciones.esChat) {
    usuario.mensajesChatCount = (Number(usuario.mensajesChatCount) || 0) + 1;
  }

  usuario.ultimoAcceso = ahoraIso;
  usuario.ultimoHeartbeat = ahoraIso;
  usuario.ultimaIp = ip;
  usuario.ultimoDispositivo = dispositivo;
  if (canal !== undefined) {
    usuario.ultimoCanal = canal;
  }

  if (!Array.isArray(usuario.ips)) usuario.ips = [];
  if (ip && ip !== 'Desconocida') {
    const existente = usuario.ips.find((item) => item && item.ip === ip);
    if (existente) {
      existente.ultimo = ahoraIso;
      existente.dispositivo = dispositivo;
      if (opciones.esLogin) {
        existente.veces = (Number(existente.veces) || 1) + 1;
      }
    } else {
      usuario.ips.unshift({
        ip,
        dispositivo,
        primero: ahoraIso,
        ultimo: ahoraIso,
        veces: 1,
      });
      if (usuario.ips.length > 12) {
        usuario.ips = usuario.ips.slice(0, 12);
      }
    }
  }
}

function enriquecerUsuarioConMetricas(u, ahoraMs = Date.now()) {
  const hbMs = u.ultimoHeartbeat ? Date.parse(u.ultimoHeartbeat) : 0;
  const enLinea = Boolean(hbMs && !Number.isNaN(hbMs) && ahoraMs - hbMs < VENTANA_ONLINE_MS);
  const tiempoOnlineSegundos = Number(u.tiempoOnlineSegundos) || 0;
  const sesionesCount = Number(u.sesionesCount) || (u.ultimoAcceso ? 1 : 0);
  const mensajesChatCount = Number(u.mensajesChatCount) || 0;
  const puntajeActividad = Math.round((tiempoOnlineSegundos / 60) * 2 + sesionesCount * 10 + mensajesChatCount * 5);

  return {
    ...u,
    enLinea,
    tiempoOnlineSegundos,
    sesionesCount,
    mensajesChatCount,
    ultimaIp: u.ultimaIp || (Array.isArray(u.ips) && u.ips[0]?.ip) || null,
    ultimoDispositivo: u.ultimoDispositivo || null,
    ultimoCanal: enLinea ? u.ultimoCanal || 'En la plataforma' : u.ultimoCanal || null,
    ips: Array.isArray(u.ips) ? u.ips : [],
    puntajeActividad,
  };
}

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
    if (esTelefonoStiven(telLimpio) || pinOk) {
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
  const ahoraMs = Date.now();
  if (actor.esStiven) return usuarios.map((u) => enriquecerUsuarioConMetricas(u, ahoraMs));
  return usuarios
    .filter(u => u.creadoPor && telefonosCoinciden(u.creadoPor, actor.telefono))
    .map((u) => enriquecerUsuarioConMetricas(u, ahoraMs));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return responderJson(res, 200, { ok: true });
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  try {
    /* ==================== API: PROXY HLS (PARA SEÑALES HTTP:// EN PÁGINA HTTPS://) ==================== */
    if (pathname === '/api/hls-proxy' && (req.method === 'GET' || req.method === 'HEAD')) {
      const targetRaw = urlObj.searchParams.get('url') || '';
      if (!targetRaw || !/^https?:\/\//i.test(targetRaw)) {
        return responderJson(res, 400, { error: 'URL de stream inválida' });
      }
      let targetUrl;
      try {
        targetUrl = new URL(targetRaw);
      } catch {
        return responderJson(res, 400, { error: 'URL malformada' });
      }
      const hostLower = targetUrl.hostname.toLowerCase();
      if (
        hostLower === 'localhost' ||
        hostLower === '127.0.0.1' ||
        hostLower === '0.0.0.0' ||
        hostLower.startsWith('169.254.') ||
        hostLower.startsWith('192.168.') ||
        hostLower.startsWith('10.')
      ) {
        return responderJson(res, 403, { error: 'Host no permitido' });
      }

      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 14000);
      req.on('close', () => {
        clearTimeout(timeout);
        ctrl.abort();
      });

      try {
        const upstream = await fetch(targetUrl.href, {
          method: req.method,
          signal: ctrl.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 VLC/3.0.18',
            'Accept': '*/*',
          },
        });
        clearTimeout(timeout);

        if (!upstream.ok) {
          res.writeHead(upstream.status, {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          });
          return res.end();
        }

        const finalUrl = upstream.url || targetUrl.href;
        const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
        const esM3u8 =
          ctype.includes('mpegurl') ||
          /\.m3u8(\?|$)/i.test(finalUrl) ||
          /\.m3u8(\?|$)/i.test(targetUrl.href);

        if (esM3u8 && req.method === 'GET') {
          const texto = await upstream.text();
          if (texto.trimStart().startsWith('#EXTM3U')) {
            const reescrito = texto
              .split(/\r?\n/)
              .map((linea) => {
                const limpia = linea.trim();
                if (!limpia) return linea;
                if (limpia.startsWith('#')) {
                  return linea.replace(/URI="([^"]+)"/gi, (_m, uri) => {
                    try {
                      const abs = new URL(uri, finalUrl).href;
                      return `URI="/api/hls-proxy?url=${encodeURIComponent(abs)}"`;
                    } catch {
                      return _m;
                    }
                  });
                }
                try {
                  const abs = new URL(limpia, finalUrl).href;
                  return `/api/hls-proxy?url=${encodeURIComponent(abs)}`;
                } catch {
                  return linea;
                }
              })
              .join('\n');

            res.writeHead(200, {
              'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
            });
            return res.end(reescrito);
          }
        }

        const headersOut = {
          'Content-Type': upstream.headers.get('content-type') || 'video/mp2t',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        };
        const clen = upstream.headers.get('content-length');
        if (clen) headersOut['Content-Length'] = clen;
        res.writeHead(200, headersOut);
        if (req.method === 'HEAD' || !upstream.body) {
          return res.end();
        }
        Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res);
        return;
      } catch (err) {
        clearTimeout(timeout);
        if (!res.headersSent) {
          res.writeHead(502, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
        }
        return res.end('Stream proxy error');
      }
    }

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

    /* ==================== API: CHAT INTERACTIVO DEL PARTIDO ==================== */
    if (pathname === '/api/chat') {
      if (req.method === 'GET') {
        const chat = leerChatDb();
        const db = leerUsuariosDb();
        const ahoraMs = Date.now();
        const onlineUsers = db.usuarios
          .map((u) => enriquecerUsuarioConMetricas(u, ahoraMs))
          .filter((u) => u.enLinea);
        return responderJson(res, 200, {
          mensajes: chat.mensajes.slice(-80),
          encuesta: chat.encuesta || null,
          onlineCount: Math.max(1, onlineUsers.length),
          onlineNombres: onlineUsers.map((u) => u.nombre).slice(0, 12),
        });
      }
      if (req.method === 'POST') {
        const body = await leerBodyJson(req);
        const apodo = String(body.apodo || '').trim().slice(0, 28);
        const pais = String(body.pais || 'Colombia').trim().slice(0, 28);
        const texto = String(body.texto || '').trim().slice(0, 220);
        const tipo = String(body.tipo || 'mensaje').trim().slice(0, 24);
        const canal = String(body.canal || '').trim().slice(0, 60);
        const tel = normalizarTelefono(body.telefono || req.headers['x-member-phone'] || '');
        if (!apodo || !texto) return responderJson(res, 400, { error: 'Apodo y mensaje requeridos' });

        // Registrar participación en actividad del miembro si está identificado
        let esAdminMsg = false;
        if (tel) {
          const db = leerUsuariosDb();
          const usr = db.usuarios.find((u) => telefonosCoinciden(u.telefono, tel));
          if (usr) {
            esAdminMsg = esTelefonoStiven(usr.telefono);
            registrarActividadUsuario(db, usr, req, { esChat: true, canal: canal || undefined });
            guardarUsuariosDb(db);
          }
        }

        let replyTo = null;
        if (body.replyTo && typeof body.replyTo === 'object') {
          replyTo = {
            id: String(body.replyTo.id || '').slice(0, 40),
            apodo: String(body.replyTo.apodo || '').trim().slice(0, 28),
            texto: String(body.replyTo.texto || '').trim().slice(0, 90),
          };
        }

        const chat = leerChatDb();
        const nuevo = {
          id: `${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          apodo,
          pais,
          texto,
          tipo,
          canal,
          esAdmin: esAdminMsg || apodo.toLowerCase() === 'stiven',
          replyTo,
          reacciones: {},
          creado: new Date().toISOString(),
        };
        chat.mensajes.push(nuevo);
        if (chat.mensajes.length > 80) chat.mensajes = chat.mensajes.slice(-80);
        guardarChatDb(chat);
        return responderJson(res, 200, { ok: true, id: nuevo.id, mensaje: nuevo });
      }
    }

    if (pathname === '/api/chat/reaccion' && req.method === 'POST') {
      const body = await leerBodyJson(req);
      const mensajeId = String(body.mensajeId || '').trim();
      const emoji = String(body.emoji || '').trim().slice(0, 8);
      const autor = String(body.usuario || body.apodo || 'Hincha').trim().slice(0, 28);
      const emojisPermitidos = ['🔥', '⚽', '😂', '👏', '🍻', '❤️'];
      if (!mensajeId || !emojisPermitidos.includes(emoji)) {
        return responderJson(res, 400, { ok: false, error: 'Reacción no válida' });
      }
      const chat = leerChatDb();
      const msg = chat.mensajes.find((m) => String(m.id) === mensajeId);
      if (!msg) return responderJson(res, 404, { ok: false, error: 'Mensaje no encontrado' });
      if (!msg.reacciones || typeof msg.reacciones !== 'object') msg.reacciones = {};
      if (!Array.isArray(msg.reacciones[emoji])) msg.reacciones[emoji] = [];

      const idx = msg.reacciones[emoji].indexOf(autor);
      if (idx >= 0) {
        msg.reacciones[emoji].splice(idx, 1);
        if (msg.reacciones[emoji].length === 0) delete msg.reacciones[emoji];
      } else {
        msg.reacciones[emoji].push(autor);
      }
      guardarChatDb(chat);
      return responderJson(res, 200, { ok: true, mensajeId, reacciones: msg.reacciones });
    }

    if (pathname === '/api/chat/encuesta' && req.method === 'POST') {
      const body = await leerBodyJson(req);
      const accion = String(body.accion || 'votar').trim();
      const usuario = String(body.usuario || 'Hincha').trim().slice(0, 28);
      const chat = leerChatDb();

      if (accion === 'crear') {
        const pregunta = String(body.pregunta || '').trim().slice(0, 100);
        const opcionesRaw = Array.isArray(body.opciones) ? body.opciones : [];
        const opciones = opcionesRaw
          .map((o) => String(o || '').trim().slice(0, 45))
          .filter(Boolean)
          .slice(0, 4);
        if (!pregunta || opciones.length < 2) {
          return responderJson(res, 400, { ok: false, error: 'Escribe una pregunta y al menos 2 opciones.' });
        }
        chat.encuesta = {
          id: `poll-${Date.now().toString(36)}`,
          pregunta,
          creadaPor: usuario,
          creada: new Date().toISOString(),
          activa: true,
          opciones: opciones.map((texto, i) => ({
            id: `opt-${i}`,
            texto,
            votos: [],
          })),
        };
        guardarChatDb(chat);
        return responderJson(res, 200, { ok: true, encuesta: chat.encuesta });
      }

      if (accion === 'votar') {
        const opcionId = String(body.opcionId || '').trim();
        if (!chat.encuesta || !chat.encuesta.activa) {
          return responderJson(res, 404, { ok: false, error: 'No hay encuesta activa.' });
        }
        for (const opt of chat.encuesta.opciones) {
          if (!Array.isArray(opt.votos)) opt.votos = [];
          opt.votos = opt.votos.filter((v) => v !== usuario);
        }
        const elegida = chat.encuesta.opciones.find((o) => o.id === opcionId);
        if (elegida) elegida.votos.push(usuario);
        guardarChatDb(chat);
        return responderJson(res, 200, { ok: true, encuesta: chat.encuesta });
      }

      if (accion === 'cerrar') {
        chat.encuesta = null;
        guardarChatDb(chat);
        return responderJson(res, 200, { ok: true, encuesta: null });
      }
    }

    /* ==================== API: PRESENCIA / LATIDO ONLINE ==================== */
    if (pathname === '/api/presencia/heartbeat' && req.method === 'POST') {
      const body = await leerBodyJson(req);
      const tel = normalizarTelefono(body.telefono || req.headers['x-member-phone'] || '');
      const canal = body.canal !== undefined ? String(body.canal || '').trim().slice(0, 70) : undefined;
      const db = leerUsuariosDb();
      let encontrado = null;
      if (tel) {
        encontrado = db.usuarios.find((u) => telefonosCoinciden(u.telefono, tel));
      }
      if (encontrado && encontrado.activo !== false) {
        registrarActividadUsuario(db, encontrado, req, { esHeartbeat: true, canal });
        guardarUsuariosDb(db);
      }
      const ahoraMs = Date.now();
      const onlineUsers = db.usuarios
        .map((u) => enriquecerUsuarioConMetricas(u, ahoraMs))
        .filter((u) => u.enLinea);
      return responderJson(res, 200, {
        ok: true,
        onlineCount: onlineUsers.length,
        onlineNombres: onlineUsers.map((u) => u.nombre),
      });
    }

    /* ==================== API: LOGIN POR TELÉFONO ==================== */
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await leerBodyJson(req);
      const entrada = String(body.telefono || '').trim();
      const db = leerUsuariosDb();

      // Si ingresa el PIN maestro de admin, también le permite entrar como Stiven (Admin)
      if (esPinValido(entrada, db.adminPin)) {
        const usrStiven = db.usuarios.find((u) => esTelefonoStiven(u.telefono));
        if (usrStiven) {
          registrarActividadUsuario(db, usrStiven, req, { esLogin: true });
          guardarUsuariosDb(db);
        }
        return responderJson(res, 200, {
          ok: true,
          esAdminPin: true,
          usuario: {
            id: usrStiven?.id || 'admin-master',
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

      registrarActividadUsuario(db, encontrado, req, { esLogin: true });
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
      registrarActividadUsuario(db, encontrado, req, { esHeartbeat: true });
      guardarUsuariosDb(db);
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

    /* ==================== API: ACTIVIDAD, TIEMPO ONLINE, IPS Y RANKING (SOLO STIVEN) ==================== */
    if (pathname === '/api/admin/actividad' && req.method === 'GET') {
      const db = leerUsuariosDb();
      const actor = resolverActorMiembros(req, {}, db, urlObj);
      const telHeader = normalizarTelefono(req.headers['x-member-phone'] || urlObj.searchParams.get('miembro') || '');
      const autorizadoStiven = (actor.autorizado && actor.esStiven) || esTelefonoStiven(telHeader);
      if (!autorizadoStiven) {
        return responderJson(res, 401, { ok: false, error: 'Solo Stiven puede ver las métricas de actividad e IPs.' });
      }

      const ahoraMs = Date.now();
      const enriquecidos = db.usuarios.map((u) => enriquecerUsuarioConMetricas(u, ahoraMs));
      const enLineaLista = enriquecidos.filter((u) => u.enLinea);
      const masActivos = [...enriquecidos].sort((a, b) => {
        if (b.puntajeActividad !== a.puntajeActividad) return b.puntajeActividad - a.puntajeActividad;
        if (b.tiempoOnlineSegundos !== a.tiempoOnlineSegundos) return b.tiempoOnlineSegundos - a.tiempoOnlineSegundos;
        const fa = a.ultimoAcceso ? Date.parse(a.ultimoAcceso) : 0;
        const fb = b.ultimoAcceso ? Date.parse(b.ultimoAcceso) : 0;
        return fb - fa;
      });

      const tiempoTotalSegundos = enriquecidos.reduce((acc, u) => acc + (u.tiempoOnlineSegundos || 0), 0);
      const totalIngresos = enriquecidos.reduce((acc, u) => acc + (u.sesionesCount || 0), 0);
      const totalMensajesChat = enriquecidos.reduce((acc, u) => acc + (u.mensajesChatCount || 0), 0);

      return responderJson(res, 200, {
        ok: true,
        actualizado: new Date().toISOString(),
        resumen: {
          totalRegistrados: enriquecidos.length,
          enLineaAhora: enLineaLista.length,
          tiempoTotalSegundos,
          totalIngresos,
          totalMensajesChat,
        },
        usuarios: enriquecidos,
        masActivos,
        historialAccesos: Array.isArray(db.historialAccesos) ? db.historialAccesos.slice(0, 50) : [],
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

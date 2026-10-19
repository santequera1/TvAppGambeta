/**
 * =============================================================
 * Gambeta Auriverde TV · js/acceso.js
 * - Control de acceso por número de teléfono (3026444564 por defecto)
 * - Panel Admin CRUD con PIN Maestro (0418 por defecto)
 * - Selector de Tema Claro / Oscuro (paleta oficial Auriverde)
 * - Integración de señales y eventos La18HD (https://la18hd.su/)
 * =============================================================
 */
(function (global) {
  'use strict';

  const CLAVE_SESION = 'gambeta.sesion.v2';
  const CLAVE_DB_LOCAL = 'gambeta.db_local.v2';
  const CLAVE_PIN_LOCAL = 'gambeta.admin_pin.v2';
  const CLAVE_TEMA = 'gambeta.tema.v1';
  const TELEFONO_STIVEN = '3026444564';

  // Limpiar claves antiguas v1 para que aplique de inmediato el nuevo PIN 0418 y número 3026444564
  try {
    localStorage.removeItem('gambeta.db_local.v1');
    localStorage.removeItem('gambeta.admin_pin.v1');
  } catch { /* ignore */ }

  const $ = (sel) => document.querySelector(sel);

  function normalizarTelefono(valor) {
    return String(valor || '').replace(/\D+/g, '');
  }

  function telefonosCoinciden(guardado, ingresado) {
    const a = normalizarTelefono(guardado);
    const b = normalizarTelefono(ingresado);
    if (!a || !b || b.length < 6) return false;
    if (a === b) return true;
    const minLen = Math.min(a.length, b.length);
    if (minLen >= 9) return a.slice(-minLen) === b.slice(-minLen);
    return false;
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatearFecha(iso) {
    if (!iso) return 'Sin ingresos aún';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /* ==================== TEMA CLARO / OSCURO ==================== */
  function aplicarTema(tema) {
    const t = tema === 'claro' ? 'claro' : 'oscuro';
    document.documentElement.setAttribute('data-tema', t);
    try { localStorage.setItem(CLAVE_TEMA, t); } catch { /* ignore */ }
    const btn = $('#btn-tema');
    if (btn) {
      btn.textContent = t === 'claro' ? 'Modo Oscuro' : 'Modo Claro';
      btn.setAttribute('aria-pressed', String(t === 'claro'));
    }
    const logoSrc = t === 'claro' ? './logo/gambeta-auriverde-01.svg' : './logo/gambeta-auriverde-02.svg';
    document.querySelectorAll('[data-logo-tema], #logo-cabecera-img').forEach((img) => {
      img.setAttribute('src', logoSrc);
    });
  }

  function iniciarTema() {
    let guardado = 'oscuro';
    try { guardado = localStorage.getItem(CLAVE_TEMA) || 'oscuro'; } catch { /* ignore */ }
    aplicarTema(guardado);
    const btn = $('#btn-tema');
    if (btn) {
      btn.addEventListener('click', () => {
        const actual = document.documentElement.getAttribute('data-tema') === 'claro' ? 'claro' : 'oscuro';
        aplicarTema(actual === 'claro' ? 'oscuro' : 'claro');
      });
    }
  }

  function esPinValido(ingresado, guardado) {
    const p = String(ingresado || '').trim();
    if (!p) return false;
    return p === String(guardado) || p === '0418' || p === '04218';
  }

  /* ==================== RESPALDO LOCAL / SERVER DB ==================== */
  async function obtenerDbRespaldo() {
    try {
      const guardado = localStorage.getItem(CLAVE_DB_LOCAL);
      if (guardado) {
        const parsed = JSON.parse(guardado);
        if (Array.isArray(parsed.usuarios) && parsed.usuarios.length > 0) return parsed;
      }
    } catch { /* ignore */ }

    try {
      const r = await fetch('./data/usuarios.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const data = await r.json();
        const db = {
          adminPin: localStorage.getItem(CLAVE_PIN_LOCAL) || data.adminPin || '0418',
          actualizado: data.actualizado || new Date().toISOString(),
          usuarios: Array.isArray(data.usuarios) ? data.usuarios : [],
        };
        guardarDbRespaldo(db);
        return db;
      }
    } catch { /* ignore */ }

    const porDefecto = {
      adminPin: localStorage.getItem(CLAVE_PIN_LOCAL) || '0418',
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
    guardarDbRespaldo(porDefecto);
    return porDefecto;
  }

  function guardarDbRespaldo(db) {
    try {
      db.actualizado = new Date().toISOString();
      localStorage.setItem(CLAVE_DB_LOCAL, JSON.stringify(db));
      if (db.adminPin) localStorage.setItem(CLAVE_PIN_LOCAL, db.adminPin);
    } catch { /* ignore */ }
  }

  /* ==================== CLIENTE HÍBRIDO API / LOCAL ==================== */
  const Api = {
    modoServidor: true,

    async login(telefono) {
      try {
        const r = await fetch('./api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefono }),
        });
        if (r.status !== 404 && r.status !== 405) {
          const data = await r.json();
          this.modoServidor = true;
          if (!r.ok || !data.ok) throw new Error(data.error || 'Número no autorizado');
          return data;
        }
      } catch (err) {
        if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('JSON')) {
          throw err;
        }
      }

      this.modoServidor = false;
      const db = await obtenerDbRespaldo();
      const limpio = String(telefono || '').trim();
      if (esPinValido(limpio, db.adminPin)) {
        return {
          ok: true,
          esAdminPin: true,
          usuario: {
            id: 'admin-master',
            nombre: 'Stiven',
            telefono: TELEFONO_STIVEN,
            nota: 'Administrador · Gambeta Auriverde',
            activo: true,
            esStiven: true,
          },
        };
      }
      const u = db.usuarios.find((x) => telefonosCoinciden(x.telefono, limpio));
      if (!u) throw new Error('Este número de teléfono no está en la lista de amigos autorizados.');
      if (u.activo === false) throw new Error('Tu acceso está temporalmente pausado por el administrador.');
      u.ultimoAcceso = new Date().toISOString();
      guardarDbRespaldo(db);
      return {
        ok: true,
        usuario: {
          ...u,
          esStiven: telefonosCoinciden(u.telefono, TELEFONO_STIVEN),
        },
      };
    },

    async verificarSesion(telefono) {
      try {
        const r = await fetch(`./api/auth/check?telefono=${encodeURIComponent(telefono)}`, { cache: 'no-store' });
        if (r.status === 401) return { activo: false };
        if (r.ok) {
          const d = await r.json();
          if (typeof d.activo === 'boolean') return d;
        }
      } catch { /* fallback */ }

      const db = await obtenerDbRespaldo();
      if (esPinValido(telefono, db.adminPin)) return { activo: true };
      const u = db.usuarios.find((x) => telefonosCoinciden(x.telefono, telefono));
      return { activo: Boolean(u && u.activo !== false), usuario: u || null };
    },

    cabecerasAuth(pin) {
      const headers = { 'Content-Type': 'application/json' };
      if (pin) headers['X-Admin-Pin'] = String(pin);
      if (sesionActual?.telefono) headers['X-Member-Phone'] = String(sesionActual.telefono);
      return headers;
    },

    filtrarLocalSegunSesion(usuarios, pin) {
      const telSesion = normalizarTelefono(sesionActual?.telefono || '');
      const esStiven =
        Boolean(sesionActual?.esStiven) ||
        (telSesion && telefonosCoinciden(telSesion, TELEFONO_STIVEN)) ||
        (!telSesion && Boolean(pin));
      if (esStiven) return { esStiven: true, lista: usuarios };
      return {
        esStiven: false,
        lista: usuarios.filter((u) => u.creadoPor && telefonosCoinciden(u.creadoPor, telSesion)),
      };
    },

    async verificarAdmin(pin) {
      try {
        const r = await fetch('./api/admin/verify', {
          method: 'POST',
          headers: this.cabecerasAuth(pin),
          body: JSON.stringify({
            adminPin: pin || '',
            miembroTelefono: sesionActual?.telefono || '',
          }),
        });
        if (r.status !== 404 && r.status !== 405) {
          const data = await r.json();
          this.modoServidor = true;
          if (!r.ok || !data.ok) throw new Error(data.error || 'PIN incorrecto');
          if (data.esStiven && pin) {
            guardarDbRespaldo({ adminPin: pin, usuarios: data.usuarios });
          }
          return data;
        }
      } catch (err) {
        if (err.message && (err.message.includes('PIN') || err.message.includes('incorrecto') || err.message.includes('autorizada'))) {
          throw err;
        }
      }

      this.modoServidor = false;
      const db = await obtenerDbRespaldo();
      const telSesion = normalizarTelefono(sesionActual?.telefono || '');
      const esMiembroRegular = Boolean(telSesion && !telefonosCoinciden(telSesion, TELEFONO_STIVEN));
      if (!esMiembroRegular && !esPinValido(pin, db.adminPin)) {
        throw new Error('PIN de administrador incorrecto.');
      }
      const { esStiven, lista } = this.filtrarLocalSegunSesion(db.usuarios, pin);
      return { ok: true, esStiven, usuarios: lista, actualizado: db.actualizado };
    },

    async crearUsuario(pin, payload) {
      try {
        const r = await fetch('./api/admin/usuarios', {
          method: 'POST',
          headers: this.cabecerasAuth(pin),
          body: JSON.stringify({
            ...payload,
            miembroTelefono: sesionActual?.telefono || '',
          }),
        });
        if (r.status !== 404 && r.status !== 405) {
          const data = await r.json();
          if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo agregar');
          if (data.esStiven && pin) {
            guardarDbRespaldo({ adminPin: pin, usuarios: data.usuarios });
          }
          return data;
        }
      } catch (err) {
        if (this.modoServidor && err.message && !err.message.includes('Failed to fetch')) throw err;
      }

      const db = await obtenerDbRespaldo();
      const nombre = String(payload.nombre || '').trim();
      const telefono = normalizarTelefono(payload.telefono);
      const nota = String(payload.nota || '').trim();
      const activo = payload.activo !== false;
      if (!nombre) throw new Error('Ingresa el nombre o apodo de tu amigo.');
      if (telefono.length < 6) throw new Error('Ingresa un número válido (mínimo 6 dígitos).');
      const dup = db.usuarios.find((u) => normalizarTelefono(u.telefono) === telefono);
      if (dup) throw new Error('Ese número de teléfono ya está registrado en el club.');
      const nuevo = {
        id: 'usr-' + Date.now().toString(36),
        nombre,
        telefono,
        nota,
        activo,
        creadoPor: normalizarTelefono(sesionActual?.telefono || TELEFONO_STIVEN),
        creadoPorNombre: sesionActual?.nombre || 'Stiven',
        creado: new Date().toISOString(),
        ultimoAcceso: null,
      };
      db.usuarios.unshift(nuevo);
      guardarDbRespaldo(db);
      const { esStiven, lista } = this.filtrarLocalSegunSesion(db.usuarios, pin);
      return { ok: true, esStiven, usuario: nuevo, usuarios: lista };
    },

    async editarUsuario(pin, id, payload) {
      try {
        const r = await fetch(`./api/admin/usuarios/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: this.cabecerasAuth(pin),
          body: JSON.stringify({
            ...payload,
            miembroTelefono: sesionActual?.telefono || '',
          }),
        });
        if (r.status !== 404 && r.status !== 405) {
          const data = await r.json();
          if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo actualizar');
          if (data.esStiven && pin) {
            guardarDbRespaldo({ adminPin: pin, usuarios: data.usuarios });
          }
          return data;
        }
      } catch (err) {
        if (this.modoServidor && err.message && !err.message.includes('Failed to fetch')) throw err;
      }

      const db = await obtenerDbRespaldo();
      const idx = db.usuarios.findIndex((u) => u.id === id);
      if (idx === -1) throw new Error('Miembro no encontrado.');
      const actual = db.usuarios[idx];
      const { esStiven } = this.filtrarLocalSegunSesion(db.usuarios, pin);
      const telSesion = normalizarTelefono(sesionActual?.telefono || '');
      if (!esStiven && (!actual.creadoPor || !telefonosCoinciden(actual.creadoPor, telSesion))) {
        throw new Error('Solo puedes modificar a los amigos que tú mismo agregaste.');
      }
      const nombre = payload.nombre !== undefined ? String(payload.nombre).trim() : actual.nombre;
      const telefono = payload.telefono !== undefined ? normalizarTelefono(payload.telefono) : actual.telefono;
      const nota = payload.nota !== undefined ? String(payload.nota).trim() : actual.nota;
      const activo = payload.activo !== undefined ? Boolean(payload.activo) : actual.activo;
      if (!nombre) throw new Error('El nombre no puede estar vacío.');
      if (telefono.length < 6) throw new Error('El teléfono debe tener al menos 6 dígitos.');
      const dup = db.usuarios.find((u, i) => i !== idx && normalizarTelefono(u.telefono) === telefono);
      if (dup) throw new Error('Ese número ya está registrado en el club.');
      db.usuarios[idx] = { ...actual, nombre, telefono, nota, activo };
      guardarDbRespaldo(db);
      const filtrado = this.filtrarLocalSegunSesion(db.usuarios, pin);
      return { ok: true, esStiven: filtrado.esStiven, usuario: db.usuarios[idx], usuarios: filtrado.lista };
    },

    async eliminarUsuario(pin, id) {
      try {
        const r = await fetch(`./api/admin/usuarios/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: this.cabecerasAuth(pin),
        });
        if (r.status !== 404 && r.status !== 405) {
          const data = await r.json();
          if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo eliminar');
          if (data.esStiven && pin) {
            guardarDbRespaldo({ adminPin: pin, usuarios: data.usuarios });
          }
          return data;
        }
      } catch (err) {
        if (this.modoServidor && err.message && !err.message.includes('Failed to fetch')) throw err;
      }

      const db = await obtenerDbRespaldo();
      const objetivo = db.usuarios.find((u) => u.id === id);
      const { esStiven } = this.filtrarLocalSegunSesion(db.usuarios, pin);
      const telSesion = normalizarTelefono(sesionActual?.telefono || '');
      if (objetivo && !esStiven && (!objetivo.creadoPor || !telefonosCoinciden(objetivo.creadoPor, telSesion))) {
        throw new Error('Solo puedes eliminar a los amigos que tú mismo agregaste.');
      }
      db.usuarios = db.usuarios.filter((u) => u.id !== id);
      guardarDbRespaldo(db);
      const filtrado = this.filtrarLocalSegunSesion(db.usuarios, pin);
      return { ok: true, esStiven: filtrado.esStiven, usuarios: filtrado.lista };
    },

    async cambiarPin(pinActual, nuevoPin) {
      try {
        const r = await fetch('./api/admin/pin', {
          method: 'PUT',
          headers: this.cabecerasAuth(pinActual),
          body: JSON.stringify({ nuevoPin }),
        });
        if (r.status !== 404 && r.status !== 405) {
          const data = await r.json();
          if (!r.ok || !data.ok) throw new Error(data.error || 'Error al cambiar PIN');
        }
      } catch (err) {
        if (this.modoServidor && err.message && !err.message.includes('Failed to fetch')) throw err;
      }
      const db = await obtenerDbRespaldo();
      db.adminPin = nuevoPin;
      guardarDbRespaldo(db);
      return { ok: true };
    },

    async importarUsuarios(pin, usuarios) {
      try {
        const r = await fetch('./api/admin/import', {
          method: 'POST',
          headers: this.cabecerasAuth(pin),
          body: JSON.stringify({ usuarios }),
        });
        if (r.status !== 404 && r.status !== 405) {
          const data = await r.json();
          if (!r.ok || !data.ok) throw new Error(data.error || 'Error al importar');
          guardarDbRespaldo({ adminPin: pin, usuarios: data.usuarios });
          return data;
        }
      } catch (err) {
        if (this.modoServidor && err.message && !err.message.includes('Failed to fetch')) throw err;
      }
      const db = await obtenerDbRespaldo();
      db.usuarios = usuarios;
      guardarDbRespaldo(db);
      return { ok: true, usuarios: db.usuarios };
    },
  };

  /* ==================== ESTADO DE SESIÓN Y ADMIN ==================== */
  let sesionActual = null;
  let adminPinActivo = '';
  let esVistaStiven = false;
  let listaUsuariosAdmin = [];
  let editandoId = null;
  let filtroAdmin = '';

  function esSesionStiven() {
    if (!sesionActual) return false;
    if (sesionActual.esStiven || sesionActual.id === 'admin-master') return true;
    return telefonosCoinciden(sesionActual.telefono, TELEFONO_STIVEN);
  }

  function leerSesion() {
    try {
      return JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
    } catch {
      return null;
    }
  }

  function guardarSesion(usuario) {
    sesionActual = usuario;
    if (!usuario) {
      adminPinActivo = '';
      esVistaStiven = false;
      listaUsuariosAdmin = [];
    }
    try {
      if (usuario) localStorage.setItem(CLAVE_SESION, JSON.stringify(usuario));
      else localStorage.removeItem(CLAVE_SESION);
    } catch { /* ignore */ }
    actualizarUiSesion();
  }

  function actualizarUiSesion() {
    const pantalla = $('#pantalla-acceso');
    const badge = $('#usuario-activo-badge');
    const nombreSpan = $('#usuario-activo-nombre');
    const btnSalir = $('#btn-cerrar-sesion');
    const video = $('#video');

    if (sesionActual) {
      if (pantalla) pantalla.hidden = true;
      document.body.classList.remove('bloqueado-acceso');
      if (badge) badge.hidden = false;
      if (nombreSpan) nombreSpan.textContent = sesionActual.nombre;
      if (btnSalir) btnSalir.hidden = false;

      const inputApodo = $('#chat-apodo');
      if (inputApodo && !inputApodo.value.trim()) {
        inputApodo.value = String(sesionActual.nombre).slice(0, 24);
      }
    } else {
      if (pantalla) pantalla.hidden = false;
      document.body.classList.add('bloqueado-acceso');
      if (badge) badge.hidden = true;
      if (btnSalir) btnSalir.hidden = true;
      if (video && !video.paused) {
        try { video.pause(); } catch { /* ignore */ }
      }
    }
  }

  /* ==================== RENDERIZADO DEL PANEL CRUD ==================== */
  function actualizarCabeceraVistaMiembros() {
    const barraStiven = $('#admin-barra-stiven');
    const cambiarPinBox = $('#admin-cambiar-pin-box');
    const subtituloModal = $('#subtitulo-admin-modal');
    const labelTotal = $('#admin-stat-label-total');

    if (barraStiven) barraStiven.hidden = !esVistaStiven;
    if (cambiarPinBox) cambiarPinBox.hidden = !esVistaStiven;
    if (labelTotal) {
      labelTotal.textContent = esVistaStiven ? 'Total Amigos' : 'Agregados por ti';
    }
    if (subtituloModal) {
      subtituloModal.textContent = esVistaStiven
        ? 'Vista Administrador (Stiven) · Viendo y gestionando todos los miembros del club.'
        : 'Agrega a tus amigos y gestiona únicamente las personas que tú registraste.';
    }
  }

  function pintarTablaAdmin() {
    const contenedor = $('#admin-lista-usuarios');
    const contadorTotal = $('#admin-stat-total');
    const contadorActivos = $('#admin-stat-activos');
    const contadorPausados = $('#admin-stat-pausados');
    const badgeModo = $('#admin-modo-almacenamiento');

    if (!contenedor) return;

    actualizarCabeceraVistaMiembros();

    const total = listaUsuariosAdmin.length;
    const activos = listaUsuariosAdmin.filter((u) => u.activo !== false).length;
    const pausados = total - activos;

    if (contadorTotal) contadorTotal.textContent = String(total);
    if (contadorActivos) contadorActivos.textContent = String(activos);
    if (contadorPausados) contadorPausados.textContent = String(pausados);
    if (badgeModo) {
      badgeModo.textContent = Api.modoServidor
        ? 'Guardado en Servidor (data/usuarios.json)'
        : 'Modo Estático (Local + Exportable JSON)';
    }

    const q = filtroAdmin.toLowerCase().trim();
    const filtrados = !q
      ? listaUsuariosAdmin
      : listaUsuariosAdmin.filter((u) =>
          `${u.nombre} ${u.telefono} ${u.nota || ''} ${u.creadoPorNombre || ''}`.toLowerCase().includes(q)
        );

    if (!filtrados.length) {
      contenedor.innerHTML = `
        <div class="border border-dashed border-linea p-4 text-center text-xs text-slate-400">
          ${
            q
              ? 'No hay amigos que coincidan con tu búsqueda.'
              : esVistaStiven
              ? 'Aún no hay números registrados. Agrega el primero arriba.'
              : 'Aún no has agregado amigos. Usa el formulario de arriba para autorizar un número.'
          }
        </div>`;
      return;
    }

    contenedor.innerHTML = filtrados
      .map((u) => {
        const activo = u.activo !== false;
        const enEdicion = editandoId === u.id;
        const mostrarInvitadoPor =
          esVistaStiven &&
          u.creadoPorNombre &&
          (!u.creadoPor || !telefonosCoinciden(u.creadoPor, TELEFONO_STIVEN));
        return `
        <div class="admin-item-usuario ${activo ? '' : 'is-pausado'} ${enEdicion ? 'is-editando' : ''}" data-uid="${esc(u.id)}">
          <div class="admin-item-info">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-sm">${esc(u.nombre)}</span>
              <span class="admin-badge-estado ${activo ? 'is-activo' : 'is-inactivo'}">
                ${activo ? 'Activo' : 'Pausado'}
              </span>
              ${u.nota ? `<span class="bg-sup-3 px-2 py-0.5 text-[11px] text-slate-300">${esc(u.nota)}</span>` : ''}
              ${mostrarInvitadoPor ? `<span class="bg-sup-3 px-2 py-0.5 text-[11px] text-auriverde-oro">Por: ${esc(u.creadoPorNombre)}</span>` : ''}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
              <span class="font-mono text-auriverde-oro font-semibold">Tel: ${esc(u.telefono)}</span>
              <span>Último acceso: ${esc(formatearFecha(u.ultimoAcceso))}</span>
            </div>
          </div>
          <div class="admin-item-acciones">
            <button type="button" class="admin-btn-accion" data-admin-accion="copiar-inv" data-uid="${esc(u.id)}" title="Copiar invitación para enviar a tu amigo">
              Invitación
            </button>
            <button type="button" class="admin-btn-accion" data-admin-accion="toggle" data-uid="${esc(u.id)}" title="${activo ? 'Pausar acceso' : 'Reactivar acceso'}">
              ${activo ? 'Pausar' : 'Activar'}
            </button>
            <button type="button" class="admin-btn-accion" data-admin-accion="editar" data-uid="${esc(u.id)}" title="Editar nombre o teléfono">
              Editar
            </button>
            <button type="button" class="admin-btn-accion is-peligro" data-admin-accion="eliminar" data-uid="${esc(u.id)}" title="Eliminar número">
              Eliminar
            </button>
          </div>
        </div>`;
      })
      .join('');
  }

  function prepararEdicion(usuario) {
    editandoId = usuario ? usuario.id : null;
    const inputNombre = $('#admin-input-nombre');
    const inputTel = $('#admin-input-telefono');
    const inputNota = $('#admin-input-nota');
    const chkActivo = $('#admin-input-activo');
    const btnGuardar = $('#admin-btn-guardar');
    const btnCancelar = $('#admin-btn-cancelar-edicion');
    const tituloForm = $('#admin-form-titulo');

    if (usuario) {
      inputNombre.value = usuario.nombre || '';
      inputTel.value = usuario.telefono || '';
      inputNota.value = usuario.nota || '';
      chkActivo.checked = usuario.activo !== false;
      btnGuardar.textContent = 'Guardar cambios';
      btnCancelar.hidden = false;
      if (tituloForm) tituloForm.textContent = `Editando a ${usuario.nombre}`;
      inputNombre.focus();
    } else {
      inputNombre.value = '';
      inputTel.value = '';
      inputNota.value = '';
      chkActivo.checked = true;
      btnGuardar.textContent = '+ Agregar amigo';
      btnCancelar.hidden = true;
      if (tituloForm) tituloForm.textContent = '+ Agregar nuevo amigo autorizado';
    }
    pintarTablaAdmin();
  }

  function mostrarAvisoAdmin(texto, tipo = 'info') {
    const el = $('#admin-feedback');
    if (!el) return;
    if (!texto) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent = texto;
    el.dataset.tipo = tipo;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.hidden = true;
    }, 5000);
  }

  async function abrirModalAdmin(pinPrevia = '') {
    const dialogo = $('#dialogo-admin');
    const vistaLogin = $('#admin-vista-pin');
    const vistaCrud = $('#admin-vista-crud');
    const inputPin = $('#admin-input-pin');
    const errorPin = $('#admin-error-pin');

    if (!dialogo) return;
    if (!dialogo.open) dialogo.showModal();

    // Si hay un miembro logueado que NO es Stiven, entra directo a gestionar solo sus propios invitados
    if (sesionActual && !esSesionStiven() && !pinPrevia) {
      try {
        const res = await Api.verificarAdmin('');
        esVistaStiven = false;
        listaUsuariosAdmin = res.usuarios || [];
        vistaLogin.hidden = true;
        vistaCrud.hidden = false;
        prepararEdicion(null);
        return;
      } catch { /* fallback */ }
    }

    if (pinPrevia) {
      try {
        const res = await Api.verificarAdmin(pinPrevia);
        adminPinActivo = pinPrevia;
        esVistaStiven = Boolean(res.esStiven);
        listaUsuariosAdmin = res.usuarios || [];
        vistaLogin.hidden = true;
        vistaCrud.hidden = false;
        prepararEdicion(null);
        return;
      } catch { /* show pin prompt */ }
    }

    if (adminPinActivo) {
      try {
        const res = await Api.verificarAdmin(adminPinActivo);
        esVistaStiven = Boolean(res.esStiven);
        listaUsuariosAdmin = res.usuarios || [];
        vistaLogin.hidden = true;
        vistaCrud.hidden = false;
        pintarTablaAdmin();
        return;
      } catch {
        adminPinActivo = '';
      }
    }

    vistaLogin.hidden = false;
    vistaCrud.hidden = true;
    if (errorPin) errorPin.hidden = true;
    if (inputPin) {
      inputPin.value = '';
      setTimeout(() => inputPin.focus(), 50);
    }
  }

  /* ==================== INTEGRACIÓN SEÑALES WEB LA18HD ==================== */
  let datosLa18hd = null;
  let categoriaLa18hd = 'COLOMBIA';
  let canalLa18hdActivo = null;

  async function cargarLa18hd() {
    const estadoEl = $('#la18hd-estado');
    if (estadoEl) estadoEl.textContent = 'Actualizando…';
    try {
      const r = await fetch('./api/la18hd?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        if (d && typeof d === 'object' && !d.error) {
          datosLa18hd = d;
          pintarLa18hd();
          if (estadoEl) estadoEl.textContent = 'En línea';
          return;
        }
      }
    } catch { /* fallback */ }

    try {
      const r2 = await fetch('./data/la18hd-status.json?t=' + Date.now(), { cache: 'no-store' });
      if (r2.ok) {
        datosLa18hd = await r2.json();
        pintarLa18hd();
        if (estadoEl) estadoEl.textContent = 'Catálogo local';
      }
    } catch {
      if (estadoEl) estadoEl.textContent = 'Sin conexión';
    }
  }

  function abrirIframeLa18hd(url, nombre) {
    const iframe = $('#iframe-la18hd');
    const barraIframe = $('#barra-iframe-externo');
    const tituloFicha = $('#ficha-titulo');
    const metaFicha = $('#ficha-meta');
    if (!iframe) return;

    if (typeof global.detenerVideoHls === 'function') {
      try { global.detenerVideoHls(); } catch { /* ignore */ }
    }
    const video = $('#video');
    if (video && !video.paused) {
      try { video.pause(); } catch { /* ignore */ }
    }

    canalLa18hdActivo = url;
    iframe.src = url;
    iframe.hidden = false;
    const capaReposo = $('#capa-reposo');
    const capaCargando = $('#capa-cargando');
    const capaError = $('#capa-error');
    if (capaReposo) capaReposo.hidden = true;
    if (capaCargando) capaCargando.hidden = true;
    if (capaError) capaError.hidden = true;
    if (barraIframe) barraIframe.hidden = false;
    const linkExterno = $('#link-abrir-la18hd') || $('#btn-abrir-externo-la18hd');
    if (linkExterno) linkExterno.href = url;
    if (tituloFicha) tituloFicha.textContent = `${nombre} · Señal Web`;
    if (metaFicha) metaFicha.textContent = 'Reproduciendo señal integrada de La18HD · Si tu navegador móvil bloquea anuncios/iframes, toca "Abrir en pestaña".';
    pintarLa18hd();
  }

  function cerrarIframeLa18hd() {
    const iframe = $('#iframe-la18hd');
    const barraIframe = $('#barra-iframe-externo');
    if (!iframe || iframe.hidden) return;
    iframe.src = 'about:blank';
    iframe.hidden = true;
    canalLa18hdActivo = null;
    if (barraIframe) barraIframe.hidden = true;
    pintarLa18hd();
  }

  function pintarLa18hd() {
    const tabsEl = $('#la18hd-tabs');
    const gridEl = $('#la18hd-canales');
    if (!tabsEl || !gridEl || !datosLa18hd) return;

    const categorias = Object.keys(datosLa18hd);
    if (!categorias.includes(categoriaLa18hd) && categorias.length) {
      categoriaLa18hd = categorias.includes('COLOMBIA') ? 'COLOMBIA' : categorias[0];
    }

    tabsEl.innerHTML = categorias
      .map((cat) => {
        const lista = Array.isArray(datosLa18hd[cat]) ? datosLa18hd[cat] : [];
        const activos = lista.filter((x) => x.Estado === 'Activo').length;
        const sel = cat === categoriaLa18hd;
        return `<button type="button" class="la18hd-tab ${sel ? 'is-activa' : ''}" data-la18-cat="${esc(cat)}">
          <span>${esc(cat)}</span>
          <small>${activos}/${lista.length}</small>
        </button>`;
      })
      .join('');

    const canales = Array.isArray(datosLa18hd[categoriaLa18hd]) ? datosLa18hd[categoriaLa18hd] : [];
    gridEl.innerHTML = canales
      .map((c) => {
        const activo = c.Estado === 'Activo';
        const reproduciendo = canalLa18hdActivo === c.Link;
        return `<button type="button" class="la18hd-card ${activo ? 'is-online' : 'is-offline'} ${reproduciendo ? 'is-playing' : ''}" data-la18-url="${esc(c.Link)}" data-la18-nombre="${esc(c.Canal)}">
          <span class="la18hd-dot ${activo ? 'is-online' : 'is-offline'}"></span>
          <span class="la18hd-nombre">${esc(c.Canal)}</span>
          <span class="la18hd-estado-tag">${activo ? 'Activo' : 'Inactivo'}</span>
        </button>`;
      })
      .join('');
  }

  /* ==================== INICIALIZACIÓN GENERAL ==================== */
  function iniciar() {
    iniciarTema();

    const formLogin = $('#form-acceso-telefono');
    const inputLoginTel = $('#input-acceso-telefono');
    const errorLogin = $('#error-acceso-telefono');
    const btnLogin = $('#btn-entrar-telefono');
    const btnAbrirAdmin = $('#btn-abrir-admin');
    const btnAbrirAdminLogin = $('#btn-admin-desde-login');
    const btnCerrarSesion = $('#btn-cerrar-sesion');

    const videoEl = $('#video');
    if (videoEl) {
      videoEl.addEventListener('play', () => {
        if (!sesionActual) {
          try { videoEl.pause(); } catch { /* ignore */ }
        }
      });
    }

    // 1. Verificar sesión guardada
    const guardada = leerSesion();
    if (guardada && guardada.telefono) {
      sesionActual = guardada;
      actualizarUiSesion();
      Api.verificarSesion(guardada.telefono).then((r) => {
        if (!r.activo) {
          guardarSesion(null);
          if (errorLogin) {
            errorLogin.textContent = 'Tu sesión expiró o tu número ya no está activo.';
            errorLogin.hidden = false;
          }
        } else if (r.usuario) {
          guardarSesion(r.usuario);
        }
      });
    } else {
      actualizarUiSesion();
    }

    setInterval(() => {
      if (!sesionActual?.telefono) return;
      Api.verificarSesion(sesionActual.telefono).then((r) => {
        if (!r.activo) guardarSesion(null);
      });
    }, 120_000);

    // 2. Login por teléfono
    if (formLogin) {
      formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const valor = inputLoginTel.value.trim();
        if (!valor) return;
        if (errorLogin) errorLogin.hidden = true;
        if (btnLogin) {
          btnLogin.disabled = true;
          btnLogin.textContent = 'Verificando…';
        }
        try {
          const res = await Api.login(valor);
          guardarSesion(res.usuario);
          inputLoginTel.value = '';
          if (res.esAdminPin) {
            abrirModalAdmin(valor);
          }
        } catch (err) {
          if (errorLogin) {
            errorLogin.textContent = err.message || 'Número no autorizado.';
            errorLogin.hidden = false;
          }
        } finally {
          if (btnLogin) {
            btnLogin.disabled = false;
            btnLogin.textContent = 'Entrar a la Cancha';
          }
        }
      });
    }

    if (btnCerrarSesion) {
      btnCerrarSesion.addEventListener('click', () => guardarSesion(null));
    }

    if (btnAbrirAdmin) {
      btnAbrirAdmin.addEventListener('click', () => abrirModalAdmin());
    }
    if (btnAbrirAdminLogin) {
      btnAbrirAdminLogin.addEventListener('click', () => abrirModalAdmin());
    }

    const dialogoAdmin = $('#dialogo-admin');
    const btnCerrarAdmin = $('#btn-cerrar-admin');
    if (btnCerrarAdmin && dialogoAdmin) {
      btnCerrarAdmin.addEventListener('click', () => dialogoAdmin.close());
      dialogoAdmin.addEventListener('click', (e) => {
        if (e.target === dialogoAdmin) dialogoAdmin.close();
      });
    }

    // 3. Desbloquear Admin con PIN (0418)
    const formPin = $('#form-admin-pin');
    if (formPin) {
      formPin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputPin = $('#admin-input-pin');
        const errorPin = $('#admin-error-pin');
        const pin = inputPin.value.trim();
        if (!pin) return;
        try {
          const res = await Api.verificarAdmin(pin);
          adminPinActivo = pin;
          esVistaStiven = Boolean(res.esStiven);
          listaUsuariosAdmin = res.usuarios || [];
          $('#admin-vista-pin').hidden = true;
          $('#admin-vista-crud').hidden = false;
          if (errorPin) errorPin.hidden = true;
          if (!sesionActual) {
            guardarSesion({
              id: 'admin-master',
              nombre: 'Stiven',
              telefono: TELEFONO_STIVEN,
              nota: 'Administrador',
              activo: true,
              esStiven: true,
            });
          }
          prepararEdicion(null);
        } catch (err) {
          if (errorPin) {
            errorPin.textContent = err.message || 'PIN incorrecto';
            errorPin.hidden = false;
          }
        }
      });
    }

    // 4. Crear / Editar en CRUD
    const formCrud = $('#form-admin-usuario');
    if (formCrud) {
      formCrud.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          nombre: $('#admin-input-nombre').value.trim(),
          telefono: $('#admin-input-telefono').value.trim(),
          nota: $('#admin-input-nota').value.trim(),
          activo: $('#admin-input-activo').checked,
        };
        try {
          if (editandoId) {
            const res = await Api.editarUsuario(adminPinActivo, editandoId, payload);
            listaUsuariosAdmin = res.usuarios;
            mostrarAvisoAdmin(`Datos de ${payload.nombre} actualizados.`, 'ok');
          } else {
            const res = await Api.crearUsuario(adminPinActivo, payload);
            listaUsuariosAdmin = res.usuarios;
            mostrarAvisoAdmin(`${payload.nombre} agregado (${normalizarTelefono(payload.telefono)}).`, 'ok');
          }
          prepararEdicion(null);
        } catch (err) {
          mostrarAvisoAdmin(err.message, 'error');
        }
      });
    }

    const btnCancelarEdicion = $('#admin-btn-cancelar-edicion');
    if (btnCancelarEdicion) {
      btnCancelarEdicion.addEventListener('click', () => prepararEdicion(null));
    }

    const inputBuscarAdmin = $('#admin-buscar');
    if (inputBuscarAdmin) {
      inputBuscarAdmin.addEventListener('input', () => {
        filtroAdmin = inputBuscarAdmin.value;
        pintarTablaAdmin();
      });
    }

    const listaContenedor = $('#admin-lista-usuarios');
    if (listaContenedor) {
      listaContenedor.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-admin-accion]');
        if (!btn) return;
        const accion = btn.dataset.adminAccion;
        const uid = btn.dataset.uid;
        const usuario = listaUsuariosAdmin.find((u) => u.id === uid);
        if (!usuario) return;

        if (accion === 'editar') {
          prepararEdicion(usuario);
          return;
        }

        if (accion === 'toggle') {
          try {
            const res = await Api.editarUsuario(adminPinActivo, uid, { activo: usuario.activo === false });
            listaUsuariosAdmin = res.usuarios;
            pintarTablaAdmin();
            mostrarAvisoAdmin(
              usuario.activo === false
                ? `Acceso reactivado para ${usuario.nombre}.`
                : `Acceso pausado para ${usuario.nombre}.`,
              'ok'
            );
          } catch (err) {
            mostrarAvisoAdmin(err.message, 'error');
          }
          return;
        }

        if (accion === 'eliminar') {
          if (!window.confirm(`¿Seguro que deseas eliminar a ${usuario.nombre} (${usuario.telefono})?`)) return;
          try {
            const res = await Api.eliminarUsuario(adminPinActivo, uid);
            listaUsuariosAdmin = res.usuarios;
            if (editandoId === uid) prepararEdicion(null);
            else pintarTablaAdmin();
            mostrarAvisoAdmin(`${usuario.nombre} fue eliminado.`, 'ok');
          } catch (err) {
            mostrarAvisoAdmin(err.message, 'error');
          }
          return;
        }

        if (accion === 'copiar-inv') {
          const urlSitio = location.origin + location.pathname;
          const textoInv = `¡Hola ${usuario.nombre}! Ya tienes acceso a Gambeta Auriverde TV.\nEntra aquí: ${urlSitio}\nTu contraseña es tu número: ${usuario.telefono}`;
          try {
            await navigator.clipboard.writeText(textoInv);
            mostrarAvisoAdmin(`Invitación para ${usuario.nombre} copiada al portapapeles.`, 'ok');
          } catch {
            mostrarAvisoAdmin(`Clave de ${usuario.nombre}: ${usuario.telefono}`, 'info');
          }
        }
      });
    }

    const btnExportar = $('#admin-btn-exportar');
    if (btnExportar) {
      btnExportar.addEventListener('click', () => {
        const blob = new Blob(
          [JSON.stringify({ actualizado: new Date().toISOString(), usuarios: listaUsuariosAdmin }, null, 2)],
          { type: 'application/json' }
        );
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'usuarios.json';
        a.click();
        URL.revokeObjectURL(a.href);
        mostrarAvisoAdmin('Archivo usuarios.json descargado.', 'ok');
      });
    }

    const inputImportar = $('#admin-input-importar');
    if (inputImportar) {
      inputImportar.addEventListener('change', async () => {
        const file = inputImportar.files?.[0];
        inputImportar.value = '';
        if (!file) return;
        try {
          const texto = await file.text();
          const parsed = JSON.parse(texto);
          const lista = Array.isArray(parsed) ? parsed : parsed.usuarios;
          if (!Array.isArray(lista)) throw new Error('El JSON no contiene una lista de usuarios válida.');
          const res = await Api.importarUsuarios(adminPinActivo, lista);
          listaUsuariosAdmin = res.usuarios;
          pintarTablaAdmin();
          mostrarAvisoAdmin(`Se importaron ${listaUsuariosAdmin.length} miembros correctamente.`, 'ok');
        } catch (err) {
          mostrarAvisoAdmin(`Error al importar: ${err.message}`, 'error');
        }
      });
    }

    const formCambiarPin = $('#form-admin-cambiar-pin');
    if (formCambiarPin) {
      formCambiarPin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputNuevoPin = $('#admin-input-nuevo-pin');
        const nuevo = inputNuevoPin.value.trim();
        if (!nuevo || nuevo.length < 4) {
          mostrarAvisoAdmin('El nuevo PIN debe tener mínimo 4 caracteres.', 'error');
          return;
        }
        try {
          await Api.cambiarPin(adminPinActivo, nuevo);
          adminPinActivo = nuevo;
          inputNuevoPin.value = '';
          mostrarAvisoAdmin('PIN de administrador actualizado correctamente.', 'ok');
        } catch (err) {
          mostrarAvisoAdmin(err.message, 'error');
        }
      });
    }

    // 5. Eventos de La18HD
    global.addEventListener('gambeta:cerrar-iframe', cerrarIframeLa18hd);
    const btnCerrarIframe = $('#btn-cerrar-iframe-la18hd');
    if (btnCerrarIframe) {
      btnCerrarIframe.addEventListener('click', cerrarIframeLa18hd);
    }

    const tabsLa18 = $('#la18hd-tabs');
    if (tabsLa18) {
      tabsLa18.addEventListener('click', (e) => {
        const b = e.target.closest('[data-la18-cat]');
        if (!b) return;
        categoriaLa18hd = b.dataset.la18Cat;
        pintarLa18hd();
      });
    }

    const gridLa18 = $('#la18hd-canales');
    if (gridLa18) {
      gridLa18.addEventListener('click', (e) => {
        const b = e.target.closest('[data-la18-url]');
        if (!b) return;
        abrirIframeLa18hd(b.dataset.la18Url, b.dataset.la18Nombre);
      });
    }

    const btnEventosLa18 = $('#btn-eventos-la18hd');
    if (btnEventosLa18) {
      btnEventosLa18.addEventListener('click', () => {
        abrirIframeLa18hd('https://la18hd.su/eventos/', 'Agenda Deportiva La18HD');
      });
    }

    const btnRefrescarLa18 = $('#btn-refrescar-la18hd');
    if (btnRefrescarLa18) {
      btnRefrescarLa18.addEventListener('click', () => cargarLa18hd());
    }

    cargarLa18hd();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})(window);

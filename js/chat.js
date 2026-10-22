(function () {
  'use strict';

  const api = new URL('./api/chat', location.href);
  const apiReaccion = new URL('./api/chat/reaccion', location.href);
  const apiEncuesta = new URL('./api/chat/encuesta', location.href);
  const $ = (id) => document.getElementById(id);

  const cajaChat = $('caja-chat');
  const form = $('chat-form');
  const lista = $('chat-mensajes');
  const estado = $('chat-estado');
  const apodo = $('chat-apodo');
  const pais = $('chat-pais');
  const texto = $('chat-texto');
  const enviar = $('chat-enviar');
  const onlinePill = $('chat-online-pill');
  const badgeNuevos = $('chat-badge-nuevos');
  const bannerGol = $('chat-banner-gol');
  const floatingLayer = $('chat-floating-layer');
  const replyBox = $('chat-reply-box');
  const replyAutor = $('chat-reply-autor');
  const replyTexto = $('chat-reply-texto');
  const btnCancelarReply = $('btn-cancelar-reply');
  const btnEncuesta = $('btn-chat-encuesta');
  const formEncuesta = $('form-chat-encuesta');
  const btnCerrarEncuesta = $('btn-cerrar-crear-encuesta');
  const cajaEncuestaActiva = $('chat-encuesta-activa');
  const btnSonido = $('btn-chat-sonido');

  const EMOJIS_REACCION = ['🔥', '⚽', '😂', '👏', '🍻', '❤️'];
  const COLORES_AVATAR = ['#027F31', '#d97706', '#2563eb', '#dc2626', '#7c3aed', '#0891b2', '#be185d'];

  let canal = '';
  let enviando = false;
  let conectado = false;
  let demora = 3500;
  let timer = null;
  let solicitud = null;
  let enVista = true;
  let fresco = '';
  let replyActual = null;
  let sonidoActivo = true;
  let noLeidos = 0;
  let cargaInicialCompleta = false;
  let ultimoGolId = '';
  let sesionUsuario = null;

  const mensajesMap = new Map();

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colorPorNombre(nombre) {
    let hash = 0;
    const s = String(nombre || 'Hincha');
    for (let i = 0; i < s.length; i++) {
      hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COLORES_AVATAR[Math.abs(hash) % COLORES_AVATAR.length];
  }

  function inicialesPorNombre(nombre) {
    const partes = String(nombre || 'H')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!partes.length) return 'H';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  function leerSesionGuardada() {
    try {
      const s = JSON.parse(localStorage.getItem('gambeta.sesion-usuario') || 'null');
      if (s && s.nombre) {
        sesionUsuario = s;
        if (apodo && !apodo.value.trim()) {
          apodo.value = String(s.nombre).slice(0, 24);
        }
      }
    } catch { /* ignore */ }
  }

  const guardarPerfil = () => {
    try {
      localStorage.setItem(
        'golstream.chat-perfil',
        JSON.stringify({ apodo: apodo.value, pais: pais.value, sonido: sonidoActivo })
      );
    } catch { /* sin memoria */ }
  };

  try {
    const perfil = JSON.parse(localStorage.getItem('golstream.chat-perfil') || '{}');
    if (perfil.apodo) apodo.value = String(perfil.apodo).slice(0, 24);
    if (perfil.pais) pais.value = perfil.pais;
    if (typeof perfil.sonido === 'boolean') sonidoActivo = perfil.sonido;
  } catch { /* perfil nuevo */ }

  leerSesionGuardada();

  if (btnSonido) {
    btnSonido.setAttribute('aria-pressed', sonidoActivo ? 'true' : 'false');
    btnSonido.textContent = sonidoActivo ? '🔔 Sonido' : '🔕 Silencio';
    btnSonido.addEventListener('click', () => {
      sonidoActivo = !sonidoActivo;
      btnSonido.setAttribute('aria-pressed', sonidoActivo ? 'true' : 'false');
      btnSonido.textContent = sonidoActivo ? '🔔 Sonido' : '🔕 Silencio';
      guardarPerfil();
    });
  }

  window.addEventListener('gambeta:sesion', (e) => {
    sesionUsuario = e.detail || null;
    if (sesionUsuario?.nombre && apodo) {
      apodo.value = String(sesionUsuario.nombre).slice(0, 24);
    }
  });

  window.addEventListener('golstream:canal', (e) => {
    canal = e.detail?.nombre || '';
  });

  function reproducirSonidoChat(esGol = false) {
    if (!sonidoActivo) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (esGol) {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.12);
        osc.frequency.setValueAtTime(783.99, now + 0.24);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.start(now);
        osc.stop(now + 0.55);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        osc.start(now);
        osc.stop(now + 0.11);
      }
    } catch { /* ignore audio block */ }
  }

  function lanzarEmojiFlotante(emoji = '⚽', cantidad = 1) {
    if (!floatingLayer) return;
    for (let i = 0; i < cantidad; i++) {
      const span = document.createElement('span');
      span.className = 'chat-float-emoji';
      span.textContent = emoji;
      span.style.left = `${12 + Math.random() * 76}%`;
      span.style.animationDelay = `${i * 90}ms`;
      floatingLayer.appendChild(span);
      setTimeout(() => span.remove(), 2200 + i * 100);
    }
  }

  function dispararCelebracionGol() {
    if (bannerGol) {
      bannerGol.hidden = false;
      clearTimeout(bannerGol._t);
      bannerGol._t = setTimeout(() => {
        bannerGol.hidden = true;
      }, 4200);
    }
    lanzarEmojiFlotante('⚽', 5);
    lanzarEmojiFlotante('🔥', 4);
    lanzarEmojiFlotante('🏆', 3);
    reproducirSonidoChat(true);
  }

  function aviso(mensaje) {
    const el = $('chat-error');
    if (!el) return;
    el.textContent = mensaje;
    el.hidden = !mensaje;
  }

  function seleccionarReply(msg) {
    if (!msg) {
      replyActual = null;
      if (replyBox) replyBox.hidden = true;
      return;
    }
    replyActual = {
      id: String(msg.id),
      apodo: String(msg.apodo || 'Hincha'),
      texto: String(msg.texto || '').slice(0, 80),
    };
    if (replyAutor) replyAutor.textContent = replyActual.apodo;
    if (replyTexto) replyTexto.textContent = replyActual.texto;
    if (replyBox) replyBox.hidden = false;
    if (texto) texto.focus();
  }

  if (btnCancelarReply) {
    btnCancelarReply.addEventListener('click', () => seleccionarReply(null));
  }

  function obtenerMiApodo() {
    return (apodo?.value || sesionUsuario?.nombre || 'Hincha').trim() || 'Hincha';
  }

  function construirHtmlMensaje(m) {
    const hora = new Date(m.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const color = colorPorNombre(m.apodo);
    const iniciales = inicialesPorNombre(m.apodo);
    const miNombre = obtenerMiApodo();
    const esMio = m.apodo && m.apodo.toLowerCase() === miNombre.toLowerCase();
    const esGol = m.tipo === 'gol' || /¡?go+l/i.test(m.texto || '');
    const reaccionesObj = m.reacciones && typeof m.reacciones === 'object' ? m.reacciones : {};

    const pillsActivas = Object.entries(reaccionesObj)
      .filter(([, listaUsuarios]) => Array.isArray(listaUsuarios) && listaUsuarios.length > 0)
      .map(([emoji, listaUsuarios]) => {
        const yoReaccione = listaUsuarios.includes(miNombre);
        return `<button type="button" class="chat-reaccion-pill ${yoReaccione ? 'is-mia' : ''}" data-reaccion-id="${esc(m.id)}" data-reaccion-emoji="${esc(emoji)}" title="${esc(listaUsuarios.join(', '))}">
          <span>${esc(emoji)}</span>
          <b>${listaUsuarios.length}</b>
        </button>`;
      })
      .join('');

    const botonesRapidosReaccion = EMOJIS_REACCION.map(
      (em) =>
        `<button type="button" class="chat-reaccion-add" data-reaccion-id="${esc(m.id)}" data-reaccion-emoji="${esc(em)}" title="Reaccionar con ${esc(em)}">${esc(em)}</button>`
    ).join('');

    return `
      <div class="chat-msg-top">
        <span class="chat-avatar" style="background:${color}">${esc(iniciales)}</span>
        <div class="chat-msg-contenido">
          <div class="chat-msg-meta">
            <strong class="chat-msg-autor">${esc(m.apodo)}</strong>
            ${m.esAdmin ? `<span class="chat-badge-admin">👑 Admin</span>` : ''}
            <span class="chat-msg-pais">${esc(m.pais || 'Colombia')}</span>
            <small class="chat-msg-hora">${esc(hora)}${m.canal ? ` · 📺 ${esc(m.canal)}` : ''}</small>
            <button type="button" class="chat-btn-reply" data-reply-id="${esc(m.id)}" title="Responder a este mensaje">↩ Responder</button>
          </div>
          ${
            m.replyTo && m.replyTo.apodo
              ? `<div class="chat-msg-cita">
                  <strong>@${esc(m.replyTo.apodo)}:</strong> <span>${esc(m.replyTo.texto)}</span>
                </div>`
              : ''
          }
          <div class="chat-cuerpo ${esGol ? 'is-gol-texto' : ''}">${esc(m.texto)}</div>
          <div class="chat-msg-footer">
            <div class="chat-reacciones-activas">${pillsActivas}</div>
            <div class="chat-reacciones-picker">${botonesRapidosReaccion}</div>
          </div>
        </div>
      </div>
    `;
  }

  function mostrar(mensajes) {
    const abajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 65;
    const vigentes = new Set(mensajes.map((m) => String(m.id)));

    for (const nodo of lista.querySelectorAll('[data-mensaje]')) {
      const id = nodo.dataset.mensaje;
      if (!vigentes.has(id)) {
        mensajesMap.delete(id);
        nodo.remove();
      }
    }

    let nuevosRecibidos = 0;
    let huboGolNuevo = false;

    for (const m of mensajes) {
      const id = String(m.id);
      const firmaReacciones = JSON.stringify(m.reacciones || {});
      const existente = mensajesMap.get(id);

      if (!existente) {
        const item = document.createElement('div');
        item.className = `chat-msg-card ${m.tipo === 'gol' ? 'is-gol' : ''} ${m.esAdmin ? 'is-admin' : ''}`;
        item.dataset.mensaje = id;
        item.innerHTML = construirHtmlMensaje(m);
        lista.appendChild(item);
        mensajesMap.set(id, { msg: m, firma: firmaReacciones, el: item });

        if (cargaInicialCompleta) {
          nuevosRecibidos++;
          if ((m.tipo === 'gol' || /¡?go+l/i.test(m.texto || '')) && ultimoGolId !== id) {
            ultimoGolId = id;
            huboGolNuevo = true;
          }
        }
      } else if (existente.firma !== firmaReacciones) {
        existente.msg = m;
        existente.firma = firmaReacciones;
        existente.el.innerHTML = construirHtmlMensaje(m);
      }
    }

    if (!cargaInicialCompleta && mensajes.length > 0) {
      ultimoGolId = String(mensajes[mensajes.length - 1].id);
    }
    cargaInicialCompleta = true;

    if (huboGolNuevo) {
      dispararCelebracionGol();
    } else if (nuevosRecibidos > 0) {
      reproducirSonidoChat(false);
    }

    if (nuevosRecibidos > 0 && cajaChat && !cajaChat.open) {
      noLeidos += nuevosRecibidos;
      if (badgeNuevos) {
        badgeNuevos.textContent = `${noLeidos} nuevo${noLeidos > 1 ? 's' : ''}`;
        badgeNuevos.hidden = false;
      }
    }

    const vacioEl = $('chat-vacio');
    if (vacioEl) vacioEl.hidden = mensajes.length > 0;
    if (abajo || nuevosRecibidos > 0) {
      lista.scrollTop = lista.scrollHeight;
    }
  }

  function pintarEncuesta(encuesta) {
    if (!cajaEncuestaActiva) return;
    if (!encuesta || !encuesta.activa || !Array.isArray(encuesta.opciones)) {
      cajaEncuestaActiva.hidden = true;
      cajaEncuestaActiva.innerHTML = '';
      return;
    }

    const miNombre = obtenerMiApodo();
    const totalVotos = encuesta.opciones.reduce(
      (acc, o) => acc + (Array.isArray(o.votos) ? o.votos.length : 0),
      0
    );

    const opcionesHtml = encuesta.opciones
      .map((o) => {
        const votos = Array.isArray(o.votos) ? o.votos : [];
        const pct = totalVotos > 0 ? Math.round((votos.length / totalVotos) * 100) : 0;
        const votadoPorMi = votos.includes(miNombre);
        return `
          <button type="button" class="chat-poll-opcion ${votadoPorMi ? 'is-votada' : ''}" data-poll-opt="${esc(o.id)}">
            <div class="chat-poll-bar" style="width:${pct}%"></div>
            <div class="chat-poll-row">
              <span>${votadoPorMi ? '✅ ' : ''}${esc(o.texto)}</span>
              <b>${pct}% (${votos.length})</b>
            </div>
          </button>
        `;
      })
      .join('');

    cajaEncuestaActiva.hidden = false;
    cajaEncuestaActiva.innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <div>
          <span class="text-[10px] font-extrabold uppercase tracking-wider text-auriverde-oro">📊 Polla en Vivo · por ${esc(encuesta.creadaPor || 'Hincha')}</span>
          <h4 class="text-xs font-bold text-white">${esc(encuesta.pregunta)}</h4>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-slate-400">${totalVotos} voto${totalVotos === 1 ? '' : 's'}</span>
          <button type="button" data-poll-cerrar="1" class="text-[11px] text-slate-400 hover:text-vivo" title="Finalizar encuesta">✕</button>
        </div>
      </div>
      <div class="grid gap-1.5">${opcionesHtml}</div>
    `;
  }

  async function consultar() {
    clearTimeout(timer);
    if (document.hidden || solicitud) return;
    solicitud = new AbortController();
    const limite = setTimeout(() => solicitud?.abort(), 8000);
    try {
      const url = fresco ? `${api.href}?n=${fresco}` : `${api.href}?t=${Date.now()}`;
      fresco = '';
      const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: solicitud.signal });
      if (!r.ok) throw Error();
      const datos = await r.json();
      if (!Array.isArray(datos.mensajes)) throw Error();

      mostrar(datos.mensajes);
      pintarEncuesta(datos.encuesta || null);

      if (onlinePill && typeof datos.onlineCount === 'number') {
        const cant = Math.max(1, datos.onlineCount);
        onlinePill.textContent = `● ${cant} en cancha`;
        if (Array.isArray(datos.onlineNombres) && datos.onlineNombres.length) {
          onlinePill.title = `Conectados ahora: ${datos.onlineNombres.join(', ')}`;
        }
      }

      conectado = true;
      demora = 3500;
      if (estado) estado.textContent = '● En vivo';
      if (!enviando) aviso('');
    } catch {
      conectado = false;
      demora = Math.min(20000, demora * 2);
      if (estado) estado.textContent = 'Reconectando…';
    } finally {
      clearTimeout(limite);
      solicitud = null;
      if (!document.hidden) timer = setTimeout(consultar, demora);
    }
  }

  async function publicar(mensaje, tipo = 'mensaje') {
    if (enviando) return;
    leerSesionGuardada();
    if (!apodo.value.trim()) {
      aviso('Escribe tu nombre o apodo para comentar en la tribuna.');
      apodo.focus();
      return;
    }
    if (!pais.value) pais.value = 'Colombia';
    if (!mensaje.trim()) return;

    guardarPerfil();
    enviando = true;
    enviar.disabled = true;
    aviso('Enviando…');

    if (tipo === 'gol' || /¡?go+l/i.test(mensaje)) {
      dispararCelebracionGol();
    } else if (tipo === 'fuego') {
      lanzarEmojiFlotante('🔥', 4);
    } else if (tipo === 'salud') {
      lanzarEmojiFlotante('🍻', 4);
    }

    const ctrl = new AbortController();
    const limite = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(api, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apodo: apodo.value.trim(),
          telefono: sesionUsuario?.telefono || '',
          pais: pais.value,
          texto: mensaje.trim(),
          tipo,
          canal,
          replyTo: replyActual,
        }),
      });
      if (r.status === 429) {
        aviso('Espera unos segundos antes de enviar otro mensaje.');
        return;
      }
      if (!r.ok) throw Error();
      if (tipo === 'mensaje' && texto.value.trim() === mensaje.trim()) {
        texto.value = '';
      }
      seleccionarReply(null);
      aviso('');
      fresco = String((await r.json().catch(() => ({}))).id || Date.now());
      void consultar();
    } catch {
      aviso('No se pudo enviar. Reintentando conexión…');
    } finally {
      clearTimeout(limite);
      enviando = false;
      enviar.disabled = false;
    }
  }

  async function enviarReaccion(mensajeId, emoji) {
    lanzarEmojiFlotante(emoji, 2);
    try {
      const r = await fetch(apiReaccion, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensajeId,
          emoji,
          usuario: obtenerMiApodo(),
        }),
      });
      if (r.ok) {
        fresco = String(Date.now());
        void consultar();
      }
    } catch { /* ignore */ }
  }

  // Eventos de formulario e interacciones
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void publicar(texto.value, 'mensaje');
    });
  }

  if (lista) {
    lista.addEventListener('click', (e) => {
      const btnReac = e.target.closest('[data-reaccion-id]');
      if (btnReac) {
        void enviarReaccion(btnReac.dataset.reaccionId, btnReac.dataset.reaccionEmoji);
        return;
      }
      const btnReply = e.target.closest('[data-reply-id]');
      if (btnReply) {
        const entrada = mensajesMap.get(btnReply.dataset.replyId);
        if (entrada?.msg) seleccionarReply(entrada.msg);
      }
    });
  }

  document.querySelectorAll('[data-chat-emoji]').forEach((b) => {
    b.addEventListener('click', () => {
      const em = b.dataset.chatEmoji || '⚽';
      lanzarEmojiFlotante(em, 2);
      if (texto) {
        texto.value = `${texto.value}${em}`;
        texto.focus();
      }
    });
  });

  document.querySelectorAll('[data-chat-rapido]').forEach((b) => {
    b.addEventListener('click', () => {
      const tipo = b.dataset.chatRapido;
      if (tipo === 'corte') window.dispatchEvent(new Event('golstream:reportar-corte'));
      void publicar(b.textContent.trim(), tipo);
    });
  });

  if (btnEncuesta && formEncuesta) {
    btnEncuesta.addEventListener('click', () => {
      formEncuesta.hidden = !formEncuesta.hidden;
      if (!formEncuesta.hidden) {
        $('encuesta-pregunta')?.focus();
      }
    });
  }

  if (btnCerrarEncuesta && formEncuesta) {
    btnCerrarEncuesta.addEventListener('click', () => {
      formEncuesta.hidden = true;
    });
  }

  if (formEncuesta) {
    formEncuesta.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pregunta = ($('encuesta-pregunta')?.value || '').trim();
      const op1 = ($('encuesta-op1')?.value || '').trim();
      const op2 = ($('encuesta-op2')?.value || '').trim();
      const op3 = ($('encuesta-op3')?.value || '').trim();
      const opciones = [op1, op2, op3].filter(Boolean);
      if (!pregunta || opciones.length < 2) {
        aviso('Escribe la pregunta de la polla y al menos 2 opciones.');
        return;
      }
      try {
        const r = await fetch(apiEncuesta, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accion: 'crear',
            usuario: obtenerMiApodo(),
            pregunta,
            opciones,
          }),
        });
        if (r.ok) {
          const d = await r.json();
          pintarEncuesta(d.encuesta);
          formEncuesta.reset();
          formEncuesta.hidden = true;
        }
      } catch { /* ignore */ }
    });
  }

  if (cajaEncuestaActiva) {
    cajaEncuestaActiva.addEventListener('click', async (e) => {
      const btnOpt = e.target.closest('[data-poll-opt]');
      if (btnOpt) {
        try {
          const r = await fetch(apiEncuesta, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accion: 'votar',
              usuario: obtenerMiApodo(),
              opcionId: btnOpt.dataset.pollOpt,
            }),
          });
          if (r.ok) {
            const d = await r.json();
            pintarEncuesta(d.encuesta);
            lanzarEmojiFlotante('🗳️', 2);
          }
        } catch { /* ignore */ }
        return;
      }

      const btnCerrar = e.target.closest('[data-poll-cerrar]');
      if (btnCerrar) {
        try {
          await fetch(apiEncuesta, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accion: 'cerrar', usuario: obtenerMiApodo() }),
          });
          pintarEncuesta(null);
        } catch { /* ignore */ }
      }
    });
  }

  if (cajaChat) {
    cajaChat.addEventListener('toggle', () => {
      if (cajaChat.open) {
        noLeidos = 0;
        if (badgeNuevos) badgeNuevos.hidden = true;
        void consultar();
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (document.hidden) solicitud?.abort();
    else void consultar();
  });
  window.addEventListener('online', () => {
    demora = 3500;
    void consultar();
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(timer);
    solicitud?.abort();
  });

  void consultar();
})();

(function () {
  'use strict';
  const api = new URL('./api/chat', location.href);
  const $ = id => document.getElementById(id);
  const form = $('chat-form'), lista = $('chat-mensajes'), estado = $('chat-estado');
  const apodo = $('chat-apodo'), pais = $('chat-pais'), texto = $('chat-texto'), enviar = $('chat-enviar');
  let canal = '', enviando = false, conectado = false, demora = 5000, timer, solicitud, enVista = false, fresco = '';
  const vistos = new Set();
  const guardar = () => { try { localStorage.setItem('golstream.chat-perfil', JSON.stringify({ apodo: apodo.value, pais: pais.value })); } catch { /* sin memoria */ } };
  try {
    const perfil = JSON.parse(localStorage.getItem('golstream.chat-perfil') || '{}');
    apodo.value = String(perfil.apodo || '').slice(0, 24);
    pais.value = perfil.pais || '';
  } catch { /* perfil nuevo */ }
  window.addEventListener('golstream:canal', e => { canal = e.detail.nombre || ''; });
  function aviso(mensaje) { $('chat-error').textContent = mensaje; $('chat-error').hidden = !mensaje; }
  function mostrar(mensajes) {
    const abajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 45;
    const vigentes = new Set(mensajes.map(m => String(m.id)));
    for (const nodo of lista.querySelectorAll('[data-mensaje]')) {
      if (!vigentes.has(nodo.dataset.mensaje)) { vistos.delete(nodo.dataset.mensaje); nodo.remove(); }
    }
    for (const m of mensajes) {
      const id = String(m.id);
      if (vistos.has(id)) continue;
      const p = document.createElement('p'); p.dataset.mensaje = id;
      const autor = document.createElement('strong'); autor.textContent = `${m.apodo} · ${m.pais}`;
      const hora = document.createElement('small');
      hora.textContent = new Date(m.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) + (m.canal ? ` · ${m.canal}` : '');
      const cuerpo = document.createElement('span'); cuerpo.className = 'chat-cuerpo'; cuerpo.textContent = m.texto;
      p.append(autor, hora, cuerpo); lista.appendChild(p); vistos.add(id);
    }
    $('chat-vacio').hidden = mensajes.length > 0;
    if (abajo) lista.scrollTop = lista.scrollHeight;
  }
  async function consultar() {
    clearTimeout(timer);
    // Sin panel en pantalla no hay consultas: la red queda para el video.
    if (document.hidden || solicitud || !enVista) return;
    solicitud = new AbortController();
    const limite = setTimeout(() => solicitud?.abort(), 8000);
    try {
      // Todos piden la misma URL: el borde de Cloudflare la sirve desde caché unos segundos.
      const url = fresco ? `${api.href}?n=${fresco}` : api.href; fresco = '';
      const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: solicitud.signal });
      if (!r.ok) throw Error();
      const datos = await r.json();
      if (!Array.isArray(datos.mensajes)) throw Error();
      mostrar(datos.mensajes); conectado = true; demora = 5000;
      estado.textContent = '● En vivo';
      if (!enviando) aviso('');
    } catch {
      conectado = false; demora = Math.min(30000, demora * 2);
      estado.textContent = 'Reconectando…';
      aviso('El chat no está disponible ahora. Reintentaremos la conexión.');
    } finally {
      clearTimeout(limite); solicitud = null;
      if (!document.hidden && enVista) timer = setTimeout(consultar, demora);
    }
  }
  async function publicar(mensaje, tipo = 'mensaje') {
    if (enviando) return;
    if (!apodo.value.trim() || !pais.value) { aviso('Elige un apodo y tu país para participar.'); (!apodo.value.trim() ? apodo : pais).focus(); return; }
    if (!mensaje.trim()) return;
    if (!conectado) { aviso('Espera a que se conecte el chat para enviar tu mensaje.'); void consultar(); return; }
    guardar(); enviando = true; enviar.disabled = true; aviso('Enviando…');
    const ctrl = new AbortController(), limite = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(api, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apodo: apodo.value.trim(), pais: pais.value, texto: mensaje.trim(), tipo, canal }) });
      if (r.status === 429) { aviso('Espera unos segundos antes de enviar otro mensaje.'); return; }
      if (!r.ok) throw Error();
      if (tipo === 'mensaje' && texto.value.trim() === mensaje.trim()) texto.value = '';
      aviso('Mensaje enviado.');
      fresco = String((await r.json().catch(() => ({}))).id || Date.now());
      void consultar();
    } catch { aviso('No se pudo enviar. Tu mensaje se conserva para que puedas reintentarlo.'); }
    finally { clearTimeout(limite); enviando = false; enviar.disabled = false; }
  }
  form.addEventListener('submit', e => { e.preventDefault(); void publicar(texto.value); });
  document.querySelectorAll('[data-chat-rapido]').forEach(b => b.addEventListener('click', () => {
    const tipo = b.dataset.chatRapido;
    // La ayuda al reproductor funciona incluso si el chat está desconectado.
    if (tipo === 'corte') window.dispatchEvent(new Event('golstream:reportar-corte'));
    void publicar(b.textContent.trim(), tipo);
  }));
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (document.hidden) solicitud?.abort();
    else void consultar();
  });
  window.addEventListener('online', () => { demora = 5000; void consultar(); });
  window.addEventListener('pagehide', () => { clearTimeout(timer); solicitud?.abort(); });
  window.addEventListener('pageshow', e => { if (e.persisted) void consultar(); });
  new IntersectionObserver(([e]) => {
    enVista = e.isIntersecting;
    if (enVista) void consultar(); else { clearTimeout(timer); solicitud?.abort(); }
  }, { rootMargin: '120px 0px' }).observe(lista);
})();

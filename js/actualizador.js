/* =========================================================================
   GolStream · Actualización automática
   - Cada publicación lleva un identificador (meta golstream-version) que
     scripts/preparar-pages.cjs escribe también en ./version.json.
   - Las pestañas abiertas consultan version.json (sin caché) cada pocos
     minutos y al volver a la pestaña. Si cambió, la página se recarga,
     salvo que haya un video reproduciéndose: entonces espera a una pausa
     con la pestaña visible.
   - Comprueba la versión al entrar y fuerza la actualización con una URL
     nueva, conservando UTM y canal. Limita las recargas para evitar bucles.
   - Con la versión "dev" (proyecto local sin empaquetar) no hace nada.
   ========================================================================= */
(function (global) {
  'use strict';

  const CFG = {
    intervaloMs: 60 * 1000,         // consulta periódica
    minEntreConsultasMs: 30 * 1000, // evita consultas seguidas al cambiar de pestaña
    claveRecarga: 'golstream:recarga-version',
  };

  const meta = document.querySelector('meta[name="golstream-version"]');
  const actual = meta?.content?.trim();
  if (!actual || actual === 'dev' || location.protocol === 'file:') return;

  let ultimaConsulta = 0;
  let pendiente = null;   // versión nueva detectada

  async function consultar() {
    const ahora = Date.now();
    if (ahora - ultimaConsulta < CFG.minEntreConsultasMs) return;
    ultimaConsulta = ahora;
    try {
      const r = await fetch(`./version.json?t=${ahora}`, { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) return;
      const { version } = await r.json();
      if (version && version !== actual) preparar(String(version));
    } catch { /* sin conexión: se vuelve a intentar más tarde */ }
  }

  function preparar(version) {
    // Si el CDN aún entrega el HTML anterior, no se recarga en bucle: una vez por versión cada 10 min.
    let previa = null;
    try { previa = JSON.parse(sessionStorage.getItem(CFG.claveRecarga) || 'null'); } catch { /* bloqueado */ }
    if (previa?.version === version && Date.now() - previa.hora < 10 * 60 * 1000) return;
    pendiente = version;
    if (videoActivo()) {
      // Nunca se corta un partido en curso: la versión nueva se aplica en la próxima pausa,
      // al terminar el video o cuando la pestaña quede en segundo plano.
      esperarVideo();
      return;
    }
    recargar();
  }

  function videoActivo() {
    const v = document.querySelector('video');
    return !!v && v.paused === false && v.ended !== true;
  }

  let esperando = false;
  function esperarVideo() {
    if (esperando) return;
    const v = document.querySelector('video');
    if (!v?.addEventListener) return;
    esperando = true;
    // Solo con la pestaña visible: una pausa causada por salir a WhatsApp no recarga en segundo plano.
    // Espera 5 s: un cambio de canal también emite "pause" y no debe disparar la recarga.
    let t = null;
    const intentar = () => {
      clearTimeout(t);
      t = setTimeout(() => { if (pendiente && document.visibilityState !== 'hidden' && !videoActivo()) recargar(); }, 5000);
    };
    v.addEventListener('pause', intentar);
    v.addEventListener('ended', intentar);
    document.addEventListener('visibilitychange', intentar);
  }

  function recargar() {
    try { sessionStorage.setItem(CFG.claveRecarga, JSON.stringify({ version: pendiente, hora: Date.now() })); } catch { /* bloqueado */ }
    // URL nueva para evitar que el CDN vuelva a entregar el HTML anterior.
    const destino = new URL(location.href);
    destino.searchParams.set('_gs_version', pendiente);
    location.replace(destino.href);
  }

  setInterval(consultar, CFG.intervaloMs);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') consultar(); });
  global.addEventListener('online', consultar);
  global.addEventListener('focus', consultar);
  // Página restaurada desde la caché atrás/adelante del navegador: comprobar de inmediato.
  global.addEventListener('pageshow', (e) => { if (e.persisted) { ultimaConsulta = 0; consultar(); } });
  void consultar();

  // Consulta manual (pruebas o consola): ignora el intervalo mínimo.
  global.GolStreamActualizador = { version: actual, consultar: () => { ultimaConsulta = 0; return consultar(); } };
})(window);

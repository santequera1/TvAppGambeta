/* =============================================================
   GolStream IPTV · verificador.js
   Verificador de estado de enlaces (stream checker).

   Para cada canal pide el manifiesto (.m3u8) o los primeros bytes
   del archivo y decide si responde. Es la misma prueba que hace el
   reproductor al arrancar. Un enlace accesible NO confirma cuadros,
   segmentos, decodificación ni reproducción sostenida.

   - Concurrencia limitada (varias peticiones a la vez, no cientos).
   - Tiempo máximo por canal y cancelación en cualquier momento.
   - Resultados guardados en localStorage (válidos unas horas), por URL:
     la misma URL comparte estado aunque aparezca en varias listas.

   API → window.VerificadorCanales
     const v = new VerificadorCanales({ guardar, leer })
     v.estado(url)                       { ok, motivo, hora } | null
     v.marcar(url, ok, motivo)           registra un resultado (también lo usa el reproductor)
     await v.verificar(canales, { onProgreso, signal, concurrencia })
   ============================================================= */
(function (global) {
  'use strict';

  const CFG = {
    concurrencia: 6,           // peticiones simultáneas
    timeoutMs: 8000,           // tiempo máximo por canal
    validezMs: 6 * 3600_000,   // un resultado guardado vale 6 horas
    validezFalloMs: 5 * 60_000, // un fallo puede ser temporal: se permite revisar pronto
    maxGuardados: 5000,        // tope de resultados en localStorage
    bytesMuestra: 4096,        // se leen como mucho 4 KB de cada respuesta
  };

  class VerificadorCanales {
    /**
     * @param {{ leer: (clave) => any, guardar: (clave, valor) => void }} memoria  almacenamiento persistente
     */
    constructor(memoria) {
      this.memoria = memoria;
      this.salud = new Map(); // url → { ok, motivo, hora }
      const guardado = memoria?.leer('salud', null);
      const ahora = Date.now();
      if (guardado && typeof guardado === 'object') {
        for (const [url, e] of Object.entries(guardado)) {
          if (e && ahora - e.hora < (e.ok === false ? CFG.validezFalloMs : CFG.validezMs)) this.salud.set(url, e);
        }
      }
      this.tGuardar = 0;
    }

    /** Estado conocido de una URL, o null si nunca se probó (o el resultado caducó). */
    estado(url) {
      const e = this.salud.get(url);
      if (!e) return null;
      if (Date.now() - e.hora > (e.ok === false ? CFG.validezFalloMs : CFG.validezMs)) {
        this.salud.delete(url);
        return null;
      }
      return e;
    }

    /** Solo un corte tras iniciar video permite ocultarlo como fallo de reproducción.
     * Una consulta inicial fallida permanece como no verificada o restringida. */
    caido(url) {
      const e = this.estado(url);
      return e?.clasificacion === 'fallo-reproduccion' && e.confirmadoAntes === true;
    }

    marcar(url, ok, motivo = '', detalle = {}) {
      const restringido = ['http-401', 'http-403', 'http-451', 'mixto', 'formato', 'navegador'].includes(detalle.codigo);
      const confirmado = ok && (detalle.confirmado === true || motivo === 'reproduce correctamente');
      const clasificacion = ok ? confirmado ? 'funcional' : 'accesible' : restringido ? 'restringido' : detalle.iniciado ? 'fallo-reproduccion' : 'no-verificado';
      this.salud.set(url, { ok, motivo, clasificacion, codigo: detalle.codigo || '', confirmadoAntes: detalle.confirmadoAntes === true,
        duracionConfirmadaMs: confirmado ? detalle.duracionConfirmadaMs || 15000 : 0,
        reproduccion: !!confirmado, origen: 'reproductor', hora: Date.now() });
      this._programarGuardado();
    }

    /** Olvida todos los resultados (para volver a verificar desde cero). */
    limpiar() {
      this.salud.clear();
      this._programarGuardado();
    }

    /**
     * Verifica una lista de canales.
     * @param {object[]} canales   { url, formato, compatible }
     * @param {{ onProgreso?: (hechos, total, vivos, caidos, canal, resultado) => void, signal?: AbortSignal, concurrencia?: number }} opciones
     * @returns {Promise<{ total, vivos, caidos, cancelado: boolean }>}
     */
    async verificar(canales, { onProgreso, signal, concurrencia = CFG.concurrencia } = {}) {
      // Una URL repetida en la vista se prueba una sola vez.
      const urls = new Map();
      for (const c of canales) if (!urls.has(c.url)) urls.set(c.url, c);
      const cola = [...urls.values()];
      const total = cola.length;
      let hechos = 0;
      let vivos = 0;
      let caidos = 0;

      const trabajador = async () => {
        while (cola.length && !signal?.aborted) {
          const canal = cola.shift();
          const r = await probarStream(canal, signal);
          if (signal?.aborted) break;
          this.salud.set(canal.url, { ...r, clasificacion: r.ok ? 'accesible' : r.restringido ? 'restringido' : 'no-verificado', origen: 'verificador', reproduccion: false, hora: Date.now() });
          hechos++;
          if (r.ok) vivos++; else caidos++;
          onProgreso?.(hechos, total, vivos, caidos, canal, r);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrencia, total) }, trabajador));
      this._programarGuardado();
      return { total, vivos, caidos, cancelado: !!signal?.aborted };
    }

    _programarGuardado() {
      clearTimeout(this.tGuardar);
      this.tGuardar = setTimeout(() => {
        // Se guardan los más recientes, hasta el tope.
        const entradas = [...this.salud.entries()].sort((a, b) => b[1].hora - a[1].hora).slice(0, CFG.maxGuardados);
        this.memoria?.guardar('salud', Object.fromEntries(entradas));
      }, 500);
    }
  }

  /**
   * Prueba un enlace.
   * @returns {Promise<{ ok: boolean, motivo: string }>}
   */
  async function probarStream(canal, signalExterna) {
    const { url } = canal;
    const inicio = Date.now();
    if (canal.compatible === false) return { ok: false, restringido: true, motivo: `formato ${String(canal.formato).toUpperCase()} no compatible con navegadores` };
    if (global.location?.protocol === 'https:' && url.startsWith('http:')) {
      return { ok: false, restringido: true, motivo: 'stream http:// bloqueado en página https:// (contenido mixto)' };
    }

    const ctrl = new AbortController();
    const cancelar = () => ctrl.abort();
    signalExterna?.addEventListener('abort', cancelar, { once: true });
    let porTiempo = false;
    const timer = setTimeout(() => { porTiempo = true; ctrl.abort(); }, CFG.timeoutMs);

    try {
      const resp = await fetch(url, {
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!resp.ok) {
        const motivos = { 401: 'acceso denegado', 403: 'acceso denegado (causa sin confirmar)', 404: 'recurso no encontrado en esta consulta', 410: 'recurso retirado en esta consulta' };
        return { ok: false, http: resp.status, restringido: [401, 403, 451].includes(resp.status), motivo: `HTTP ${resp.status}${motivos[resp.status] ? ` · ${motivos[resp.status]}` : resp.status >= 500 ? ' · error del servidor' : ''}` };
      }

      // Se lee solo una muestra: suficiente para reconocer un manifiesto HLS.
      const tipo = (resp.headers.get('content-type') || '').toLowerCase();
      const muestra = await leerMuestra(resp);
      const texto = new TextDecoder('utf-8').decode(muestra);

      if (texto.trimStart().startsWith('#EXTM3U')) {
        if (/#EXT-X-(STREAM-INF|TARGETDURATION|MEDIA|MEDIA-SEQUENCE)/i.test(texto)) return { ok: true, hlsValido: true, respuestaMs: Math.max(0, Date.now() - inicio), motivo: 'manifiesto HLS válido' };
        return { ok: true, motivo: 'manifiesto M3U' };
      }
      if (/^(video|audio)\//.test(tipo) || tipo.includes('mpegurl') || tipo.includes('octet-stream')) {
        return { ok: true, motivo: `responde (${tipo.split(';')[0]})` };
      }
      if (/^\s*</.test(texto)) return { ok: false, motivo: 'devuelve una página web, no video' };
      return canal.formato === 'hls'
        ? { ok: false, motivo: 'la respuesta no es un manifiesto HLS' }
        : { ok: true, motivo: 'responde' };
    } catch {
      if (signalExterna?.aborted) return { ok: false, motivo: 'verificación cancelada' };
      if (porTiempo) return { ok: false, motivo: `no respondió en ${CFG.timeoutMs / 1000} s` };
      return { ok: false, motivo: 'fallo de red, TLS o CORS; causa sin confirmar' };
    } finally {
      clearTimeout(timer);
      signalExterna?.removeEventListener('abort', cancelar);
    }
  }

  /** Lee hasta CFG.bytesMuestra bytes y corta la descarga (un stream en vivo nunca "termina"). */
  async function leerMuestra(resp) {
    if (!resp.body?.getReader) return new Uint8Array(await resp.arrayBuffer()).slice(0, CFG.bytesMuestra);
    const lector = resp.body.getReader();
    const partes = [];
    let bytes = 0;
    try {
      while (bytes < CFG.bytesMuestra) {
        const { done, value } = await lector.read();
        if (done) break;
        partes.push(value);
        bytes += value.byteLength;
      }
    } finally {
      lector.cancel().catch(() => {});
    }
    const salida = new Uint8Array(Math.min(bytes, CFG.bytesMuestra));
    let pos = 0;
    for (const p of partes) {
      const parte = p.subarray(0, salida.length - pos);
      salida.set(parte, pos);
      pos += parte.length;
      if (pos >= salida.length) break;
    }
    return salida;
  }

  VerificadorCanales.probarStream = probarStream;
  global.VerificadorCanales = VerificadorCanales;
})(window);

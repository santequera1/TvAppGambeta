/* =============================================================
   GolStream IPTV · epg.js
   Guía de programación en vivo (EPG / XMLTV).

   - Fuentes: URL declarada en la cabecera del M3U (x-tvg-url),
     URLs agregadas por el usuario (con proxy CORS opcional) y
     archivos .xml / .xml.gz cargados desde el equipo.
   - El análisis del XMLTV corre en el Worker (parser.js).
   - Enlace canal ↔ guía:
       1) tvg-id exacto ("Mega.cl@SD" ↔ "Mega.cl")
       2) nombre: palabras significativas en común
          ("Mega (Chile)" ↔ "Canal.Mega.(Chile).cl")
   - Persistencia: metadatos de fuentes en localStorage y datos
     de programación en IndexedDB (pueden ocupar varios MB).

   API → window.GuiaEPG
     const epg = new GuiaEPG({ memoria, onCambio })
     await epg.iniciar()
     epg.ahora(canal)            { actual, siguientes } | null
     epg.textoBusqueda(canal)    títulos de lo que se emite en las próximas horas (normalizado)
     epg.programasEntre(canal, desde, hasta)  programas que se cruzan con ese intervalo
     epg.agregarUrl(url) · epg.agregarArchivo(file) · epg.agregarDesdeLista(urls)
     epg.quitar(id) · epg.recargar(id) · epg.fuentes · epg.proxy
   ============================================================= */
(function (global) {
  'use strict';

  const { cargarGuia, procesarGuiaEnSegundoPlano, normalizar } = global.ParserM3U;

  const CFG = {
    refrescoUrlMs: 6 * 3600_000,      // las fuentes por URL se vuelven a descargar cada 6 h
    ventanaAtrasMs: 3 * 3600_000,     // programas guardados desde 3 h atrás…
    ventanaAdelanteMs: 3 * 24 * 3600_000, // …hasta 3 días adelante
    horasBusqueda: 6,                 // el buscador mira lo que se emite en las próximas 6 h
    siguientes: 3,                    // programas "a continuación" en la ficha
  };

  // Palabras que no ayudan a identificar un canal al comparar nombres.
  const VACIAS = new Set(['canal', 'channel', 'tv', 'television', 'hd', 'sd', 'fhd', 'uhd', '4k', 'de', 'del', 'la', 'el',
    'los', 'las', 'the', 'en', 'vivo', 'live', 'senal', 'oficial', 'feed']);
  // Países y regiones: acompañan al nombre ("Mega (Chile)") pero no lo identifican.
  const GENERICAS = new Set(['chile', 'argentina', 'mexico', 'peru', 'colombia', 'uruguay', 'paraguay', 'bolivia', 'ecuador',
    'venezuela', 'espana', 'spain', 'brasil', 'brazil', 'italia', 'italy', 'uk', 'usa', 'us', 'eeuu', 'latin', 'america',
    'latinoamerica', 'latino', 'latam', 'sur', 'south', 'internacional', 'international', 'cl', 'ar', 'mx', 'es', 'br', 'it']);

  /* ---------- IndexedDB mínima (clave → valor) ---------- */
  const BD = {
    _bd: null,
    abrir() {
      if (this._bd) return this._bd;
      this._bd = new Promise((resolve) => {
        try {
          const req = indexedDB.open('golstream', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('epg');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null); // navegador sin IndexedDB o bloqueado: se trabaja solo en memoria
        }
      });
      return this._bd;
    },
    async op(modo, fn) {
      const bd = await this.abrir();
      if (!bd) return undefined;
      return new Promise((resolve) => {
        try {
          const tx = bd.transaction('epg', modo);
          const req = fn(tx.objectStore('epg'));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    },
    leer: (k) => BD.op('readonly', (s) => s.get(k)),
    guardar: (k, v) => BD.op('readwrite', (s) => s.put(v, k)),
    borrar: (k) => BD.op('readwrite', (s) => s.delete(k)),
  };

  /* ---------- Utilidades de enlace ---------- */

  function tokens(texto) {
    return normalizar(texto).split(' ').filter((t) => t && !VACIAS.has(t));
  }

  /** "Canal.Mega.(Chile).cl" → { texto: "Canal Mega (Chile)", pais: "cl" } · "Mega.cl@SD" → "Mega", "cl" */
  function limpiarId(id) {
    let s = String(id).replace(/@.*$/, '');
    let pais = '';
    const m = s.match(/\.([a-z]{2})$/i);
    if (m) { pais = m[1].toLowerCase(); s = s.slice(0, -3); }
    return { texto: s.replace(/[._]+/g, ' '), pais };
  }

  /**
   * "Firma" de un nombre para compararlo:
   *   principal: palabras que identifican, fuera de paréntesis  ("Chilevisión (CHV)" → chilevision)
   *   todo:      palabras que identifican, incluidas las de paréntesis (→ chilevision, chv)
   *   genericas: países/regiones (→ chile)
   */
  function firma(texto) {
    const todo = tokens(texto);
    const principal = tokens(String(texto).replace(/\([^)]*\)|\[[^\]]*\]/g, ' '));
    return {
      principal: new Set(principal.filter((t) => !GENERICAS.has(t))),
      todo: new Set(todo.filter((t) => !GENERICAS.has(t))),
      genericas: new Set(todo.filter((t) => GENERICAS.has(t))),
      // Nombre completo sin paréntesis ni "Canal" inicial: decide en nombres solo genéricos ("TV Chile").
      exacto: normalizar(String(texto).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')).replace(/^canal /, ''),
    };
  }

  const contiene = (mayor, menor) => [...menor].every((t) => mayor.has(t));
  const iguales = (a, b) => a.size === b.size && contiene(a, b);

  /**
   * ¿Es el mismo canal? El nombre principal de cada uno debe estar contenido en el nombre
   * completo del otro: "Mega (Chile)" = "Canal Mega (Chile)", pero "Mega 2" ≠ "Mega" y
   * "ESPN Premium" ≠ "ESPN". Si el nombre es solo genérico ("TV Chile"), debe coincidir entero.
   */
  function mismoCanal(a, b) {
    if (!a.todo.size) return !b.todo.size && a.genericas.size > 0 && a.exacto === b.exacto;
    return b.principal.size > 0 && contiene(a.todo, b.principal) && contiene(b.todo, a.principal);
  }

  class GuiaEPG {
    /**
     * @param {{ memoria: { leer, guardar }, onCambio?: (motivo) => void }} opciones
     */
    constructor({ memoria, onCambio } = {}) {
      this.memoria = memoria;
      this.onCambio = onCambio || (() => {});
      this.fuentes = (memoria?.leer('epgFuentes', []) || []).filter((f) => f && f.id && f.tipo);
      this.proxy = memoria?.leer('epgProxy', '') || '';
      this.datos = new Map();   // id de fuente → { canales, programas }
      this.version = 0;         // cambia con cada modificación de las guías
      this._reindexar();
    }

    get activa() { return this.datos.size > 0; }

    /** Carga desde IndexedDB lo guardado y refresca las fuentes por URL que estén viejas. */
    async iniciar() {
      for (const f of this.fuentes) {
        const d = await BD.leer(`fuente:${f.id}`);
        if (d) this.datos.set(f.id, d);
      }
      this._reindexar();
      this.onCambio('inicio');
      for (const f of this.fuentes) {
        if (f.tipo !== 'archivo' && (!this.datos.has(f.id) || Date.now() - (f.hora || 0) > CFG.refrescoUrlMs)) {
          this.recargar(f.id).catch(() => {});
        }
      }
    }

    /* ---------------- Gestión de fuentes ---------------- */

    async agregarUrl(url, { automatica = false } = {}) {
      const existente = this.fuentes.find((f) => f.tipo !== 'archivo' && f.valor === url);
      if (existente) return this.recargar(existente.id);
      const f = { id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, tipo: automatica ? 'lista' : 'url', valor: url, nombre: nombreDeUrl(url) };
      this.fuentes.push(f);
      this._guardarFuentes();
      return this.recargar(f.id);
    }

    /** Guías declaradas por la lista M3U (#EXTM3U x-tvg-url="…"): se agregan solas, una vez. */
    agregarDesdeLista(urls = []) {
      for (const u of urls) {
        if (!this.fuentes.some((f) => f.valor === u)) this.agregarUrl(u, { automatica: true }).catch(() => {});
      }
    }

    async agregarArchivo(archivo) {
      const f = { id: `a${Date.now().toString(36)}`, tipo: 'archivo', valor: archivo.name, nombre: archivo.name, estado: 'cargando' };
      this.fuentes.push(f);
      this._notificar('fuentes');
      try {
        const guia = await procesarGuiaEnSegundoPlano(await archivo.arrayBuffer(), this._ventana());
        await this._aplicar(f, guia);
      } catch (err) {
        Object.assign(f, { estado: 'error', mensaje: err.message || String(err) });
        this._guardarFuentes();
        this._notificar('fuentes');
        throw err;
      }
      return f;
    }

    async recargar(id) {
      const f = this.fuentes.find((x) => x.id === id);
      if (!f || f.tipo === 'archivo') return f;
      Object.assign(f, { estado: 'cargando', mensaje: '' });
      this._notificar('fuentes');
      try {
        const guia = await cargarGuia(f.valor, { proxy: this.proxy, ventana: this._ventana() });
        await this._aplicar(f, guia);
      } catch (err) {
        Object.assign(f, { estado: 'error', mensaje: err.codigo === 'red'
          ? 'El servidor no permite leer la guía desde el navegador (CORS). Configura un proxy CORS o descarga el archivo y cárgalo.'
          : err.message || String(err) });
        this._guardarFuentes();
        this._notificar('fuentes');
        throw err;
      }
      return f;
    }

    quitar(id) {
      this.fuentes = this.fuentes.filter((f) => f.id !== id);
      this.datos.delete(id);
      BD.borrar(`fuente:${id}`);
      this._guardarFuentes();
      this._reindexar();
      this._notificar('datos');
    }

    guardarProxy(valor) {
      this.proxy = String(valor || '').trim();
      this.memoria?.guardar('epgProxy', this.proxy || null);
    }

    async _aplicar(f, guia) {
      const datos = { canales: guia.canales, programas: guia.programas };
      this.datos.set(f.id, datos);
      Object.assign(f, {
        estado: 'ok', mensaje: '', hora: Date.now(),
        canales: guia.canales.length, programas: guia.total,
      });
      await BD.guardar(`fuente:${f.id}`, datos);
      this._guardarFuentes();
      this._reindexar();
      this._notificar('datos');
    }

    _ventana() {
      const ahora = Date.now();
      return { desde: ahora - CFG.ventanaAtrasMs, hasta: ahora + CFG.ventanaAdelanteMs };
    }

    _guardarFuentes() {
      this.memoria?.guardar('epgFuentes', this.fuentes.map(({ id, tipo, valor, nombre, estado, mensaje, hora, canales, programas }) =>
        ({ id, tipo, valor, nombre, estado: estado === 'cargando' ? '' : estado, mensaje, hora, canales, programas })));
    }

    _notificar(motivo) {
      this.onCambio(motivo);
    }

    /* ---------------- Índice de canales de la guía ---------------- */

    _reindexar() {
      this.version++;
      this.porId = new Map();      // id exacto (minúsculas) → clave interna
      this.porToken = new Map();   // palabra → Set de claves
      this.info = new Map();       // clave → { fuente, id, conjuntos: [Set de palabras], pais, programas }
      this.enlaces = new Map();    // memo: canal → clave | null
      this.busquedas = new Map();  // memo: canal → { bloque, texto }

      for (const [fuente, d] of this.datos) {
        for (const c of d.canales) {
          const clave = `${fuente}|${c.id}`;
          this._indexar(fuente, c.id, c.nombres, d.programas[c.id] || []);
        }
        // Programas de canales que no están declarados en <channel> (algunas guías lo omiten).
        for (const id of Object.keys(d.programas)) {
          if (!this.info.has(`${fuente}|${id}`)) this._indexar(fuente, id, [], d.programas[id]);
        }
      }
    }

    _indexar(fuente, id, nombres, programas) {
      const clave = `${fuente}|${id}`;
      const { texto, pais } = limpiarId(id);
      const firmas = [texto, ...nombres].map(firma).filter((f) => f.todo.size || f.genericas.size);
      this.info.set(clave, { fuente, id, firmas, pais, programas });
      const idMin = id.toLowerCase();
      if (!this.porId.has(idMin)) this.porId.set(idMin, clave);
      for (const f of firmas) for (const t of [...f.todo, ...f.genericas]) {
        if (!this.porToken.has(t)) this.porToken.set(t, new Set());
        this.porToken.get(t).add(clave);
      }
    }

    /** Busca el canal de la guía que corresponde a un canal de la lista. */
    enlazar(canal) {
      if (!this.info.size || !canal) return null;
      const memo = canal.url + '|' + canal.nombre;
      if (this.enlaces.has(memo)) return this.enlaces.get(memo);

      let clave = null;
      // 1) tvg-id exacto, con y sin la variante "@SD/@HD".
      const tvg = String(canal.tvgId || '').toLowerCase();
      if (tvg) clave = this.porId.get(tvg) || this.porId.get(tvg.replace(/@.*$/, '')) || null;

      // 2) Nombre: mismo nombre principal (ver mismoCanal), ignorando país y palabras de relleno.
      if (!clave) {
        const propia = firma(canal.nombre);
        const candidatos = new Set();
        for (const t of [...propia.todo, ...propia.genericas]) for (const k of this.porToken.get(t) || []) candidatos.add(k);
        const pais = String(canal.pais || '').toLowerCase();
        let mejor = -Infinity;
        for (const k of candidatos) {
          const inf = this.info.get(k);
          for (const f of inf.firmas) {
            if (!mismoCanal(propia, f)) continue;
            let puntaje = 0;
            if (pais && inf.pais === pais) puntaje += 2;                  // mismo país: preferido
            if (f.genericas.size && iguales(propia.genericas, f.genericas)) puntaje += 1;
            if (inf.programas.length) puntaje += 0.5;                     // con programación
            puntaje -= Math.abs(f.todo.size - propia.todo.size) * 0.1;    // el nombre más parecido
            if (puntaje > mejor) { mejor = puntaje; clave = k; }
          }
        }
      }
      this.enlaces.set(memo, clave);
      return clave;
    }

    /** Programación del canal en este momento: programa actual (con % de avance) y los siguientes. */
    ahora(canal, t = Date.now()) {
      const clave = this.enlazar(canal);
      if (!clave) return null;
      const lista = this.info.get(clave).programas;
      if (!lista.length) return { enlazado: true, actual: null, siguientes: [] };
      // Búsqueda binaria del último programa que empezó antes de "t".
      let lo = 0;
      let hi = lista.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lista[mid][0] <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      const actual = idx >= 0 && lista[idx][1] > t ? programa(lista[idx], t) : null;
      // Lo que viene: los programas que empiezan después de "t" (idx + 1 en adelante).
      const siguientes = lista.slice(idx + 1, idx + 1 + CFG.siguientes).map((p) => programa(p, t));
      return { enlazado: true, actual, siguientes };
    }

    /** Texto normalizado con lo que se emite en las próximas horas (para buscar "Colo-Colo", "noticias"…). */
    textoBusqueda(canal, t = Date.now()) {
      if (!this.info.size) return '';
      const memo = canal.url + '|' + canal.nombre;
      const bloque = Math.floor(t / 300_000); // se recalcula cada 5 minutos
      const previo = this.busquedas.get(memo);
      if (previo && previo.bloque === bloque) return previo.texto;
      const clave = this.enlazar(canal);
      let texto = '';
      if (clave) {
        const hasta = t + CFG.horasBusqueda * 3600_000;
        texto = normalizar(this.info.get(clave).programas
          .filter(([i, f]) => f > t && i < hasta)
          .map((p) => `${p[2]} ${p[3]} ${p[5]}`)
          .join(' '));
      }
      this.busquedas.set(memo, { bloque, texto });
      return texto;
    }

    /** Programas del canal que se cruzan con el intervalo [desde, hasta) (para la agenda de partidos). */
    programasEntre(canal, desde, hasta) {
      const clave = this.enlazar(canal);
      if (!clave) return [];
      return this.info.get(clave).programas
        .filter(([i, f]) => i < hasta && f > desde)
        .map((p) => programa(p, Date.now()));
    }

    /** Cuántos canales de una lista tienen guía enlazada. */
    contarEnlazados(canales) {
      let n = 0;
      for (const c of canales) if (this.enlazar(c)) n++;
      return n;
    }
  }

  function programa(p, t) {
    const [inicio, fin, titulo, subtitulo, desc, categoria, icono] = p;
    return {
      inicio, fin, titulo, subtitulo, desc, categoria, icono,
      progreso: Math.min(100, Math.max(0, ((t - inicio) / (fin - inicio)) * 100)),
    };
  }

  function nombreDeUrl(url) {
    try {
      const u = new URL(url);
      const archivo = u.pathname.split('/').filter(Boolean).pop() || '';
      return `${archivo || u.hostname} · ${u.hostname}`;
    } catch {
      return url;
    }
  }

  global.GuiaEPG = GuiaEPG;
})(window);

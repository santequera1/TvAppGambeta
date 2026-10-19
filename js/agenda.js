/* =============================================================
   GolStream IPTV · agenda.js
   Agenda de fútbol chileno: partidos de hoy y próximos.

   - Fuente: TheSportsDB (API pública y gratuita, permite CORS).
     Solo datos de calendario: equipos, hora, estado y marcador.
     No entrega ni enlaza transmisiones.
   - Competencias: Primera División, Primera B, Copa Chile,
     Copa de la Liga, Segunda División y la selección (La Roja).
   - Refresco: agenda completa cada 30 min; si hay un partido en
     juego (o a punto de empezar), solo esas competencias cada 60 s.
   - La última agenda se guarda en localStorage para mostrarse al
     instante al abrir la app.
   - ¿Dónde verlo? Lo decide app.js cruzando cada partido con la
     guía de programación (EPG) mediante coincidePrograma().

   API → window.AgendaFutbol
     const agenda = new AgendaFutbol({ memoria, onCambio })
     agenda.iniciar()                 muestra lo guardado y descarga lo nuevo
     agenda.actualizar({ completa })  fuerza una descarga
     agenda.hoy() · agenda.proximos() eventos ordenados por hora
     agenda.estado                    'ok' | 'cargando' | 'error' · agenda.actualizando
     coincidePrograma(evento, texto)  ¿el programa de TV es este partido?
   ============================================================= */
(function (global) {
  'use strict';

  const { normalizar } = global.ParserM3U;

  // Clave "123": clave pública de prueba de TheSportsDB (uso no comercial).
  const API = 'https://www.thesportsdb.com/api/v1/json/123';

  /**
   * Competencias chilenas en TheSportsDB (ids comprobados con search_all_leagues.php?c=Chile).
   * "pago": canal que tiene los derechos en Chile, cuando se conoce con seguridad.
   * Derechos ANFP 2026: Primera División y Primera B → TNT Sports. Revisar si cambian de temporada.
   */
  const COMPETENCIAS = [
    { id: '4627', nombre: 'Primera División', corto: 'Primera', pago: 'TNT Sports' },
    { id: '4899', nombre: 'Primera B', corto: 'Primera B', pago: 'TNT Sports' },
    { id: '5378', nombre: 'Copa Chile', corto: 'Copa Chile' },
    { id: '5858', nombre: 'Copa de la Liga', corto: 'Copa de la Liga' },
    { id: '5481', nombre: 'Segunda División', corto: 'Segunda' },
  ];
  const LA_ROJA = { id: '134499', nombre: 'Selección chilena', corto: 'La Roja' };

  const CFG = {
    refrescoCompletoMs: 30 * 60_000, // agenda completa
    refrescoVivoMs: 60_000,          // marcadores mientras hay partidos en juego
    tiempoEsperaMs: 12_000,          // por petición
    duracionMs: 2 * 3600_000,        // un partido (con entretiempo y descuentos) dura ≈ 2 h
    previaMs: 15 * 60_000,           // "por empezar": 15 min antes
    diasProximos: 7,                 // "Próximos" muestra hasta una semana
  };

  // Estados de TheSportsDB para fútbol.
  const EN_JUEGO = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);
  const TERMINADO = new Set(['FT', 'AET', 'PEN', 'AOT', 'MATCH FINISHED']);
  const SUSPENDIDO = new Set(['PST', 'CANC', 'ABD', 'SUSP', 'AWD', 'WO', 'POSTPONED', 'CANCELLED']);
  const DETALLE = { '1H': '1T', HT: 'Entretiempo', '2H': '2T', ET: 'Alargue', BT: 'Pausa', P: 'Penales', INT: 'Interrumpido' };

  /* ---------- Fechas ---------- */

  /** Fecha local "AAAA-MM-DD" (la del usuario, no la UTC). */
  function fechaLocal(t = Date.now()) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** TheSportsDB entrega strTimestamp en UTC sin zona ("2026-10-12T20:00:00"). */
  function horaInicio(e) {
    if (e.strTimestamp) {
      const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? e.strTimestamp : `${e.strTimestamp}Z`);
      if (!Number.isNaN(t)) return t;
    }
    if (e.dateEvent) {
      const t = Date.parse(`${e.dateEvent}T${e.strTime || '00:00:00'}Z`);
      if (!Number.isNaN(t)) return t;
    }
    return null;
  }

  /* ---------- Normalización de eventos ---------- */

  const httpsOVacio = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
  const marcador = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  function convertir(e, comp) {
    const inicio = horaInicio(e);
    if (!inicio || !e.strHomeTeam || !e.strAwayTeam) return null;
    const crudo = String(e.strStatus || '').trim().toUpperCase();
    let estado = 'previa';
    if (EN_JUEGO.has(crudo)) estado = 'vivo';
    else if (TERMINADO.has(crudo)) estado = 'final';
    else if (SUSPENDIDO.has(crudo)) estado = 'suspendido';
    return {
      id: String(e.idEvent),
      comp: comp.corto,
      compNombre: comp.nombre,
      pago: comp.pago || '',
      // Las selecciones juegan amistosos y eliminatorias: se muestra el torneo real.
      torneo: comp === LA_ROJA ? traducirTorneo(e.strLeague) : comp.nombre,
      local: String(e.strHomeTeam),
      visita: String(e.strAwayTeam),
      escudoLocal: httpsOVacio(e.strHomeTeamBadge),
      escudoVisita: httpsOVacio(e.strAwayTeamBadge),
      golesLocal: marcador(e.intHomeScore),
      golesVisita: marcador(e.intAwayScore),
      inicio,
      estado,
      detalle: DETALLE[crudo] || '',
      estadio: e.strVenue ? String(e.strVenue) : '',
      roja: comp === LA_ROJA,
    };
  }

  function traducirTorneo(nombre) {
    const n = String(nombre || '');
    if (/friendl/i.test(n)) return 'Amistoso internacional';
    if (/world cup qualifying/i.test(n)) return 'Eliminatorias';
    if (/copa am[eé]rica/i.test(n)) return 'Copa América';
    if (/world cup/i.test(n)) return 'Mundial';
    return n || 'Selección';
  }

  /**
   * Estado según el reloj, para cuando la API va atrasada: un partido "previa" cuya hora ya
   * pasó figura como "comenzó" y uno que ya debió terminar no se queda "en vivo" para siempre.
   */
  function estadoReal(ev, t = Date.now()) {
    if (ev.estado === 'previa') {
      if (t >= ev.inicio + CFG.duracionMs) return 'sin-dato';
      if (t >= ev.inicio) return 'comenzo';
      if (t >= ev.inicio - CFG.previaMs) return 'por-empezar';
    }
    if (ev.estado === 'vivo' && t > ev.inicio + CFG.duracionMs + 3600_000) return 'final';
    return ev.estado;
  }

  /* ---------- ¿Un programa de TV es este partido? ---------- */

  // Palabras que no distinguen a un equipo ("Deportes Iquique" se reconoce por "iquique").
  const RELLENO = new Set(['club', 'deportes', 'deportivo', 'cd', 'cf', 'fc', 'sc', 'cs', 'sadp', 'sa', 'de', 'del', 'la', 'el',
    'los', 'las', 'y', 'chile', 'universidad', 'union', 'unido', 'san', 'santiago', 'atletico', 'puerto', 'municipal', 'city', 'u']);
  // Nombres que se escriben distinto en las guías de TV.
  const ALIAS = {
    'universidad de chile': ['u de chile', 'la u', 'universidad de chile'],
    'universidad catolica': ['u catolica', 'la uc', 'universidad catolica', 'catolica'],
    'universidad de concepcion': ['u de concepcion', 'udec', 'universidad de concepcion'],
    'colo colo': ['colo colo', 'colocolo'],
    chile: ['chile', 'la roja', 'seleccion chilena'],
  };

  const claves = new Map(); // memo: nombre de equipo → { tokens, frases }
  function clavesEquipo(nombre) {
    if (claves.has(nombre)) return claves.get(nombre);
    const n = normalizar(nombre);
    const r = {
      tokens: n.split(' ').filter((t) => t.length >= 3 && !RELLENO.has(t)),
      frases: ALIAS[n] || [],
    };
    // Sin palabras propias (ej. "Universidad de Chile"): se exige el nombre completo.
    if (!r.tokens.length && !r.frases.length) r.frases = [n];
    claves.set(nombre, r);
    return r;
  }

  /** ¿Aparece el equipo en el texto (normalizado y con espacios en los extremos)? */
  function nombraEquipo(texto, nombre) {
    const { tokens, frases } = clavesEquipo(nombre);
    return frases.some((f) => texto.includes(` ${f} `)) || tokens.some((t) => texto.includes(` ${t} `));
  }

  /**
   * Un programa corresponde al partido si nombra a los dos equipos.
   * (Con uno solo habría falsos positivos: noticieros y resúmenes nombran equipos todo el día.)
   * @param {string} texto  título + subtítulo + descripción del programa, ya normalizados
   */
  function coincidePrograma(ev, texto) {
    const t = ` ${texto} `;
    return nombraEquipo(t, ev.local) && nombraEquipo(t, ev.visita);
  }

  /* ---------- Descarga ---------- */

  async function pedir(ruta, signal) {
    const ctrl = new AbortController();
    const cortar = () => ctrl.abort();
    signal?.addEventListener('abort', cortar, { once: true });
    const reloj = setTimeout(cortar, CFG.tiempoEsperaMs);
    try {
      const r = await fetch(`${API}/${ruta}`, { signal: ctrl.signal, cache: 'no-store' });
      if (r.status === 429) throw Object.assign(new Error('Demasiadas consultas a la agenda; se reintentará en un momento.'), { codigo: 'limite' });
      if (!r.ok) throw new Error(`La agenda respondió ${r.status}.`);
      return await r.json();
    } finally {
      clearTimeout(reloj);
      signal?.removeEventListener('abort', cortar);
    }
  }

  /** Ejecuta tareas de a pocas a la vez (la API gratuita limita las consultas por minuto). */
  async function enTandas(tareas, simultaneas = 3) {
    const resultados = new Array(tareas.length);
    let i = 0;
    async function obrero() {
      while (i < tareas.length) {
        const j = i++;
        try { resultados[j] = { ok: true, valor: await tareas[j]() }; } catch (error) { resultados[j] = { ok: false, error }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(simultaneas, tareas.length) }, obrero));
    return resultados;
  }

  class AgendaFutbol {
    /**
     * @param {{ memoria: { leer, guardar }, onCambio?: () => void }} opciones
     */
    constructor({ memoria, onCambio } = {}) {
      this.memoria = memoria;
      this.onCambio = onCambio || (() => {});
      const guardada = memoria?.leer('agenda', null);
      this.eventos = new Map((guardada?.eventos || []).filter((e) => e && e.id && e.inicio).map((e) => [e.id, e]));
      this.hora = guardada?.hora || 0;  // última descarga completa
      this.estado = this.eventos.size ? 'ok' : 'cargando';
      this.mensaje = '';
      this.actualizando = false;
      this.version = 0;
      this._timer = 0;
      this._ctrl = null;
    }

    iniciar() {
      this._limpiarViejos();
      this.onCambio();
      const vieja = Date.now() - this.hora > CFG.refrescoCompletoMs;
      this.actualizar({ completa: vieja || !this.eventos.size }).catch(() => {});
    }

    hoy(t = Date.now()) {
      const dia = fechaLocal(t);
      return this._ordenados().filter((e) => fechaLocal(e.inicio) === dia
        // Partido que empezó ayer tarde y sigue en juego pasada la medianoche.
        || (t - e.inicio < CFG.duracionMs && t >= e.inicio));
    }

    proximos(t = Date.now()) {
      const finDeHoy = new Date(t).setHours(24, 0, 0, 0);
      const limite = t + CFG.diasProximos * 24 * 3600_000;
      return this._ordenados().filter((e) => e.inicio >= finDeHoy && e.inicio <= limite);
    }

    /**
     * @param {{ completa?: boolean }} opciones  completa: todas las competencias, hoy, mañana y próximos.
     *   Si no, solo las competencias con partidos en juego o por empezar (refresco de marcadores).
     */
    async actualizar({ completa = true } = {}) {
      clearTimeout(this._timer);
      this._ctrl?.abort();
      const ctrl = new AbortController();
      this._ctrl = ctrl;

      const t = Date.now();
      const hoy = fechaLocal(t);
      const manana = fechaLocal(t + 24 * 3600_000);
      const tareas = [];
      const compsActivas = completa ? COMPETENCIAS : COMPETENCIAS.filter((c) => this._tieneActividad(c.nombre, t));

      for (const comp of compsActivas) {
        // La API agrupa por fecha UTC: un partido a las 22:30 de Chile figura al día siguiente.
        for (const d of completa ? [hoy, manana] : this._fechasUtcActivas(comp.nombre, t)) {
          tareas.push(() => pedir(`eventsday.php?d=${d}&l=${comp.id}`, ctrl.signal).then((j) => ({ comp, lista: j.events })));
        }
        if (completa) tareas.push(() => pedir(`eventsnextleague.php?id=${comp.id}`, ctrl.signal).then((j) => ({ comp, lista: j.events })));
      }
      if (completa || this._tieneActividad(LA_ROJA.nombre, t)) {
        tareas.push(() => pedir(`eventsnext.php?id=${LA_ROJA.id}`, ctrl.signal).then((j) => ({ comp: LA_ROJA, lista: j.events })));
        // El partido de hoy de La Roja ya no figura en "próximos" una vez que empieza.
        tareas.push(() => pedir(`eventslast.php?id=${LA_ROJA.id}`, ctrl.signal).then((j) => ({ comp: LA_ROJA, lista: j.results })));
      }
      if (!tareas.length) return this._programar(t);

      if (!this.eventos.size) this.estado = 'cargando';
      this.actualizando = true;
      this.onCambio();
      const resultados = await enTandas(tareas);
      if (this._ctrl !== ctrl) return; // llegó una actualización más nueva
      this.actualizando = false;

      let exitos = 0;
      let error = null;
      for (const r of resultados) {
        if (!r.ok) { error = r.error; continue; }
        exitos++;
        for (const e of r.valor.lista || []) {
          if (r.valor.comp !== LA_ROJA && String(e.idLeague) !== r.valor.comp.id) continue;
          const ev = convertir(e, r.valor.comp);
          if (ev) this.eventos.set(ev.id, ev);
        }
      }

      if (exitos) {
        this.estado = 'ok';
        this.mensaje = error ? 'Algunas competencias no respondieron.' : '';
        if (completa) this.hora = t;
      } else if (error?.name !== 'AbortError') {
        this.estado = this.eventos.size ? 'ok' : 'error';
        this.mensaje = error?.codigo === 'limite' ? error.message
          : 'No se pudo consultar la agenda (sin conexión o la API no respondió).';
      }
      this._limpiarViejos();
      this._guardar();
      this.version++;
      this.onCambio();
      this._programar(t);
    }

    detener() {
      clearTimeout(this._timer);
      this._ctrl?.abort();
    }

    /* ---------- Internos ---------- */

    _ordenados() {
      return [...this.eventos.values()].sort((a, b) => a.inicio - b.inicio || a.comp.localeCompare(b.comp));
    }

    /** Partidos de la competencia en juego o que empiezan dentro de 15 min. */
    _activos(nombre, t) {
      return [...this.eventos.values()].filter((e) => {
        if (e.compNombre !== nombre) return false;
        const est = estadoReal(e, t);
        return est === 'vivo' || est === 'comenzo' || est === 'por-empezar';
      });
    }

    _tieneActividad(nombre, t) {
      return this._activos(nombre, t).length > 0;
    }

    /** Fechas UTC (las que usa la API) de los partidos activos de la competencia. */
    _fechasUtcActivas(nombre, t) {
      return [...new Set(this._activos(nombre, t).map((e) => new Date(e.inicio).toISOString().slice(0, 10)))];
    }

    _programar(t) {
      clearTimeout(this._timer);
      const hayActividad = [...COMPETENCIAS, LA_ROJA].some((c) => this._tieneActividad(c.nombre, t));
      const completaEn = Math.max(5_000, this.hora + CFG.refrescoCompletoMs - Date.now());
      if (hayActividad && CFG.refrescoVivoMs < completaEn) {
        this._timer = setTimeout(() => this.actualizar({ completa: false }).catch(() => {}), CFG.refrescoVivoMs);
      } else {
        this._timer = setTimeout(() => this.actualizar({ completa: true }).catch(() => {}), completaEn);
      }
    }

    /** Descarta partidos de días anteriores (salvo uno que siga en juego). */
    _limpiarViejos(t = Date.now()) {
      const inicioHoy = new Date(t).setHours(0, 0, 0, 0);
      for (const [id, e] of this.eventos) {
        if (e.inicio < inicioHoy && t - e.inicio > CFG.duracionMs) this.eventos.delete(id);
      }
    }

    _guardar() {
      this.memoria?.guardar('agenda', { hora: this.hora, eventos: [...this.eventos.values()] });
    }
  }

  global.AgendaFutbol = AgendaFutbol;
  global.AgendaFutbol.estadoReal = estadoReal;
  global.AgendaFutbol.coincidePrograma = coincidePrograma;
  global.AgendaFutbol.CFG = CFG;
})(window);

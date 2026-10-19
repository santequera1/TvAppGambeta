// Grupo oficial abierto de GolStream IPTV.
const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/ES0y1cWLTOqAkpjTEazRII?s=cl&p=a&mlu=4&ilr=4';
const HLS_ESTABLE = Object.freeze({
  enableWorker: true, lowLatencyMode: false,
  liveSyncDurationCount: 4, liveMaxLatencyDurationCount: 8,
  maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferHole: 0.5,
  manifestLoadingTimeOut: 10000, manifestLoadingMaxRetry: 4,
  levelLoadingMaxRetry: 4, fragLoadingMaxRetry: 6, startLevel: -1,
});
const CANALES_PARTIDO_HOY = [
  {
    "nombre": "ESPN",
    "url": "https://barinaslive1.boldmss.com/ESPN/ESPN.isml/ESPN.m3u8",
    "opciones": [
      {
        "nombre": "ESPN Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN/ESPN.isml/ESPN.m3u8",
        "origen": "data/catalogo-pe.m3u"
      },
      {
        "nombre": "ESPN 2 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_2/ESPN_2.isml/ESPN_2.m3u8",
        "origen": "data/catalogo-pe.m3u"
      },
      {
        "nombre": "ESPN 3 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_3/ESPN_3.isml/ESPN_3.m3u8",
        "origen": "data/catalogo-co.m3u"
      },
      {
        "nombre": "ESPN 4 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_4/ESPN_4.isml/ESPN_4.m3u8",
        "origen": "data/catalogo-pe.m3u"
      },
      {
        "nombre": "ESPN 5 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_5/ESPN_5.isml/ESPN_5.m3u8",
        "origen": "data/catalogo-pe.m3u"
      },
      {
        "nombre": "ESPN 6 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_6/ESPN_6.isml/ESPN_6.m3u8",
        "origen": "data/catalogo-pe.m3u"
      },
      {
        "nombre": "ESPN 7 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_7/ESPN_7.isml/ESPN_7.m3u8",
        "origen": "data/catalogo-pe.m3u"
      }
    ]
  },
  {
    "nombre": "ESPN 2 / CHV",
    "url": "https://barinaslive1.boldmss.com/ESPN_2/ESPN_2.isml/ESPN_2.m3u8",
    "opciones": [
      {
        "nombre": "ChileVision (1080p)",
        "url": "http://15.204.246.24:8080/CHVHD/index.m3u8",
        "origen": "https://iptv-org.github.io/iptv/index.m3u"
      }
    ],
    "respaldos": [
      {
        "nombre": "ESPN 2 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_2/ESPN_2.isml/ESPN_2.m3u8",
        "origen": "data/catalogo-pe.m3u"
      }
    ]
  },
  {
    "nombre": "ESPN 3 / ESPN 5 / Pluto Deportes",
    "url": "https://barinaslive1.boldmss.com/ESPN_3/ESPN_3.isml/ESPN_3.m3u8",
    "opciones": [
      {
        "nombre": "Pluto TV Deportes",
        "url": "https://jmp2.uk/plu-5dcde07af1c85b0009b18651.m3u8",
        "origen": "https://iptv-org.github.io/iptv/index.m3u"
      },
      {
        "nombre": "Pluto TV Competition",
        "url": "https://jmp2.uk/plu-603fde9026ecbf0007752c2c.m3u8",
        "origen": "https://iptv-org.github.io/iptv/index.m3u"
      },
      {
        "nombre": "Pluto TV E-Sports",
        "url": "https://jmp2.uk/plu-5ff3934600d4c7000733ff49.m3u8",
        "origen": "https://iptv-org.github.io/iptv/index.m3u"
      },
      {
        "nombre": "Pluto TV Esportes",
        "url": "https://jmp2.uk/plu-5f32d2db0af67400077f29c4.m3u8",
        "origen": "https://iptv-org.github.io/iptv/index.m3u"
      }
    ],
    "respaldos": [
      {
        "nombre": "ESPN 3 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_3/ESPN_3.isml/ESPN_3.m3u8",
        "origen": "data/catalogo-co.m3u"
      },
      {
        "nombre": "ESPN 5 Latin America (1080p)",
        "url": "https://barinaslive1.boldmss.com/ESPN_5/ESPN_5.isml/ESPN_5.m3u8",
        "origen": "data/catalogo-pe.m3u"
      }
    ]
  }
];
/* =============================================================
   GolStream IPTV · app.js
   Controlador de la interfaz y fuentes deportivas configuradas.
   Integra listas M3U, verificación en vivo y accesos oficiales.

   1. Listas oficiales, configuración, memoria, estado y módulos (verificador, EPG)
   2. Utilidades
   3. Favoritos (persisten entre listas)
   4. Carga de listas (caché en memoria, progreso de descarga y análisis) y pestañas
   5. Mis listas y búsqueda global (cross-list)
   6. Filtros, búsqueda incremental y lista de canales (renderizado por lotes)
   7. Verificador de enlaces (stream checker)
   8. Reproductor, ficha, guía de programación y aviso en pantalla
   9. Agenda de fútbol chileno (partidos de hoy + dónde verlos en TV abierta)
  10. Control remoto por teclado y teclas multimedia
  11. Eventos de la interfaz e inicio
   ============================================================= */
(function () {
  'use strict';

  const {
    cargarLista, prepararUrlLista, validarUrl, normalizar, traducirGrupo,
    clasificar, NOMBRES_CATEGORIA, // filtro inteligente (se calcula en el Worker del parser)
  } = window.ParserM3U;

  /* ---------------- 1. Configuración, memoria y estado ---------------- */

  const IPTV_ORG = 'https://iptv-org.github.io/iptv';
  const FREE_TV = 'https://raw.githubusercontent.com/Free-TV/IPTV/master';
  const IPTV_NEXUS = 'https://dearbulut.github.io/iptv';
  const accesoOficial = () => null; // Los canales solo se reproducen dentro del video.

  /** Listas oficiales que aparecen como pestañas (y en el panel vacío). */
  const LISTAS = [
    { id: 'todos', emoji: '', nombre: 'Verificados', detalle: 'Señales HTTPS comprobadas en el servidor: carga instantánea', url: new URL('./data/catalogo-pro.json', location.href).href },
    { id: 'nexus', emoji: '', nombre: 'IPTV Nexus (8.4K)', detalle: '8.400+ canales activos verificados con guía EPG integrada', url: `${IPTV_NEXUS}/playlists/online.m3u` },
    { id: 'deportes', emoji: '', nombre: 'Deportes', detalle: 'Canales deportivos de todo el mundo', url: `${IPTV_ORG}/categories/sports.m3u` },
    { id: 'co', emoji: '', nombre: 'Colombia', detalle: 'Televisión pública y canales regionales', url: `${IPTV_ORG}/countries/co.m3u` },
    { id: 'ar', emoji: '', nombre: 'Argentina', detalle: 'Fútbol, noticias y canales generales', url: `${IPTV_ORG}/countries/ar.m3u` },
    { id: 'cl', emoji: '', nombre: 'Chile', detalle: 'Canales nacionales y regionales', url: `${IPTV_ORG}/countries/cl.m3u` },
    { id: 'es', emoji: '', nombre: 'España', detalle: 'Ligas de fútbol y canales nacionales', url: `${IPTV_ORG}/countries/es.m3u` },
    { id: 'br', emoji: '', nombre: 'Brasil', detalle: 'Canales principales y deportes', url: `${IPTV_ORG}/countries/br.m3u` },
    { id: 'pe', emoji: '', nombre: 'Perú', detalle: 'Canales nacionales, noticias y cultura', url: `${IPTV_ORG}/countries/pe.m3u` },
    { id: 'it', emoji: '', nombre: 'Italia', detalle: 'Serie A y canales de TV', url: `${IPTV_ORG}/countries/it.m3u` },
    { id: 'uk', emoji: '', nombre: 'Inglaterra', detalle: 'Premier League y contenido británico', url: `${IPTV_ORG}/countries/uk.m3u` },
    { id: 'spa', emoji: '', nombre: 'Español', detalle: 'Macro-lista de canales en español', url: `${IPTV_ORG}/languages/spa.m3u` },
    { id: 'noticias', emoji: '', nombre: 'Noticias', detalle: 'Noticias de todo el mundo', url: `${IPTV_ORG}/categories/news.m3u` },
  ];

  /** Listas adicionales del menú "Más listas…". */
  const LISTAS_EXTRA = [
    { grupo: 'Más países', nombre: 'México', url: `${IPTV_ORG}/countries/mx.m3u` },
    { grupo: 'Más países', nombre: 'Uruguay', url: `${IPTV_ORG}/countries/uy.m3u` },
    { grupo: 'Más países', nombre: 'Estados Unidos', url: `${IPTV_ORG}/countries/us.m3u` },
    { grupo: 'Más países', nombre: 'Francia', url: `${IPTV_ORG}/countries/fr.m3u` },
    { grupo: 'Más países', nombre: 'Alemania', url: `${IPTV_ORG}/countries/de.m3u` },
    { grupo: 'Más países', nombre: 'Portugal', url: `${IPTV_ORG}/countries/pt.m3u` },
    { grupo: 'Temáticas', nombre: 'Noticias (mundial)', url: `${IPTV_ORG}/categories/news.m3u` },
    { grupo: 'Temáticas', nombre: 'Películas (mundial)', url: `${IPTV_ORG}/categories/movies.m3u` },
    { grupo: 'Temáticas', nombre: 'Música (mundial)', url: `${IPTV_ORG}/categories/music.m3u` },
    { grupo: 'Fuentes independientes', nombre: 'Free-TV - canales gratuitos curados', url: `${FREE_TV}/playlist.m3u8` },
    { grupo: 'Fuentes independientes', nombre: 'IPTV Nexus - streams online', url: `${IPTV_NEXUS}/playlists/online.m3u` },
    { grupo: 'Fuentes independientes', nombre: 'IPTV Nexus - mejor stream por canal', url: `${IPTV_NEXUS}/playlists/best.m3u` },
    { grupo: 'Idiomas', nombre: 'Portugués', url: `${IPTV_ORG}/languages/por.m3u` },
    { grupo: 'Idiomas', nombre: 'Inglés', url: `${IPTV_ORG}/languages/eng.m3u` },
  ];

  const CONFIG = {
    // Catálogo curado en el servidor (scripts/curar-catalogo.cjs): JSON ya analizado, sin Worker ni parseo.
    listaPorDefecto: new URL('./data/catalogo-pro.json', location.href).href,
    lote: 40,             // tarjetas por tanda: el resto se dibuja al acercarse al final (memoria en móviles)
    retardoZapping: 350,  // ms: con ↑/↓ la selección cambia al instante y el stream carga al detenerse
    duracionOsd: 2500,    // ms que se ve el aviso de canal en pantalla
    esperaDigitos: 1200,  // ms para terminar de teclear un número de canal
    cacheMinutos: 10,     // las pestañas reutilizan una lista ya descargada durante este tiempo
    cacheMaxListas: 4,    // listas en memoria además de "Mis listas" (que siempre se conservan)
    maxGlobales: 150,     // resultados de otras listas que se muestran en la búsqueda global
    maxVerificar: 6,
    maxCanales: 15000,    // la lista mundial completa tiene ~11.000; las tarjetas se dibujan por tandas
  };

  /**
   * Memoria local (localStorage) con prefijo propio y a prueba de fallos:
   * en modo incógnito o con el almacenamiento bloqueado, la app sigue funcionando sin memoria.
   */
  const Memoria = {
    prefijo: 'golstream.',
    leer(clave, defecto = null) {
      try {
        const crudo = localStorage.getItem(this.prefijo + clave);
        if (crudo == null) return defecto;
        try { return JSON.parse(crudo); } catch { return crudo; } // valores antiguos guardados sin JSON
      } catch {
        return defecto;
      }
    },
    guardar(clave, valor) {
      try {
        if (valor == null) localStorage.removeItem(this.prefijo + clave);
        else localStorage.setItem(this.prefijo + clave, JSON.stringify(valor));
      } catch { /* almacenamiento lleno o bloqueado */ }
    },
  };

  const PAGINA_HTTPS = location.protocol === 'https:';

  const estado = {
    canales: [],          // todos los canales de la lista actual
    filtrados: [],        // los que se ven ahora (vista + búsqueda + filtros)
    mostrados: 0,         // cuántos de "filtrados" ya están dibujados
    filtro: 'todos',      // 'todos' | 'deportes' | 'noticias' | 'peliculas' | 'entretenimiento' | 'favoritos'
    conteos: {},          // canales por categoría inteligente en la lista actual
    listaUrl: null,       // URL de la lista cargada (para marcar la pestaña activa)
    cache: new Map(),     // url → { resultado, hora }: cambiar de pestaña es instantáneo
    version: 0,           // cambia cuando cambia el conjunto base (lista o favoritos)
    previo: { clave: '', consulta: '' }, // para la búsqueda incremental
    grupo: '',
    consulta: '',
    tokens: [],
    ocultarGeo: Memoria.leer('ocultarGeo', true) !== false,
    ocultarMuertos: Memoria.leer('ocultarMuertos', true) !== false,
    buscarGlobal: Memoria.leer('buscarGlobal', true) !== false,
    favoritos: cargarFavoritos(), // Map<url, ficha del canal>
    misListas: (Memoria.leer('misListas', []) || []).filter((l) => l && typeof l.url === 'string'), // [{ url, nombre }]
    erroresListas: new Map(), // url → mensaje (listas guardadas que no se pudieron indexar)
    indexando: null,      // URL de "Mis listas" que se está descargando en segundo plano
    globales: { lista: [], total: 0 }, // resultados de la búsqueda global
    verificacion: null,   // AbortController de la verificación en curso
    actual: null,         // canal seleccionado
    reproduciendo: false,
    carga: null,          // AbortController de la descarga en curso
    ultimaUrl: null,      // para "Reintentar"
    niveles: [],
    eventosMedidos: new Set(), // evento/intento: las recuperaciones no duplican mediciones
  };

  const $ = (sel) => document.querySelector(sel);
  const dom = {
    infoLista: $('#info-lista'),
    pestanas: $('#pestanas-listas'),
    formLista: $('#form-lista'),
    inputLista: $('#input-lista'),
    btnCargar: $('#btn-cargar'),
    btnDefecto: $('#btn-defecto'),
    btnGuardarLista: $('#btn-guardar-lista'),
    textoGuardarLista: $('#texto-guardar-lista'),
    btnEpg: $('#btn-epg'),
    cuentaEpg: $('#cuenta-epg'),
    misListas: $('#mis-listas'),
    selPreset: $('#sel-preset'),
    estadoCarga: $('#estado-carga'),
    textoCarga: $('#texto-carga'),
    barraCarga: $('#barra-carga'),
    btnCancelar: $('#btn-cancelar'),
    errorCarga: $('#error-carga'),
    textoErrorCarga: $('#texto-error-carga'),
    btnReintentarLista: $('#btn-reintentar-lista'),

    zonaReproductor: $('#zona-reproductor'),
    contenedorVideo: $('#contenedor-video'),
    video: $('#video'),
    capaReposo: $('#capa-reposo'),
    textoReposo: $('#texto-reposo'),
    subtextoReposo: $('#subtexto-reposo'),
    capaCargando: $('#capa-cargando'),
    textoCargando: $('#texto-cargando'),
    capaError: $('#capa-error'),
    textoError: $('#texto-error'),
    btnReintentar: $('#btn-reintentar'),
    btnCopiarError: $('#btn-copiar-error'),
    btnSiguienteError: $('#btn-siguiente-error'),
    osd: $('#osd'),
    osdNumero: $('#osd-numero'),
    osdTexto: $('#osd-texto'),
    btnPip: $('#btn-pip'),
    btnPantalla: $('#btn-pantalla'),
    fichaMeta: $('#ficha-meta'),
    fichaTitulo: $('#ficha-titulo'),
    fichaUrl: $('#ficha-url'),
    fichaEpg: $('#ficha-epg'),
    fichaAvisos: $('#ficha-avisos'),
    btnAnterior: $('#btn-anterior'),
    btnSiguiente: $('#btn-siguiente'),
    selCalidad: $('#sel-calidad'),
    btnFavFicha: $('#btn-fav-ficha'),
    btnCopiar: $('#btn-copiar'),
    btnAtajos: $('#btn-atajos'),

    buscador: $('#buscador'),
    chips: $('#chips'),
    selGrupo: $('#sel-grupo'),
    chkGlobal: $('#chk-global'),
    estadoGlobal: $('#estado-global'),
    chkGeo: $('#chk-geo'),
    chkMuertos: $('#chk-muertos'),
    btnVerificar: $('#btn-verificar'),
    textoVerificar: $('#texto-verificar'),
    estadoVerificacion: $('#estado-verificacion'),
    barraVerificacionCaja: $('#barra-verificacion-caja'),
    barraVerificacion: $('#barra-verificacion'),
    contador: $('#contador'),
    panelVacio: $('#panel-vacio'),
    atajos: $('#atajos'),
    lista: $('#lista-canales'),
    centinela: $('#centinela'),
    sinResultados: $('#sin-resultados'),
    seccionGlobal: $('#seccion-global'),
    listaGlobal: $('#lista-global'),
    cuentaGlobal: $('#cuenta-global'),

    agenda: $('#agenda'),
    btnAgendaPlegar: $('#btn-agenda-plegar'),
    btnAgendaActualizar: $('#btn-agenda-actualizar'),
    agendaCuerpo: $('#agenda-cuerpo'),
    agendaResumen: $('#agenda-resumen'),
    agendaHoy: $('#agenda-hoy'),
    agendaProximosCaja: $('#agenda-proximos-caja'),
    agendaProximos: $('#agenda-proximos'),
    agendaCuentaProximos: $('#agenda-cuenta-proximos'),
    agendaNota: $('#agenda-nota'),

    dialogoAtajos: $('#dialogo-atajos'),
    btnCerrarAtajos: $('#btn-cerrar-atajos'),
    dialogoEpg: $('#dialogo-epg'),
    btnCerrarEpg: $('#btn-cerrar-epg'),
    epgResumen: $('#epg-resumen'),
    epgFuentes: $('#epg-fuentes'),
    formEpg: $('#form-epg'),
    inputEpg: $('#input-epg'),
    zonaEpgArchivo: $('#zona-epg-archivo'),
    inputEpgArchivo: $('#input-epg-archivo'),
    inputProxy: $('#input-proxy'),
    btnGuardarProxy: $('#btn-guardar-proxy'),
    toasts: $('#toasts'),
  };

  // Módulos: verificador de enlaces (js/verificador.js), guía de programación (js/epg.js)
  // y agenda de fútbol chileno (js/agenda.js).
  const verificador = new VerificadorCanales(Memoria);
  let estadosCanales = new EstadosCanales();
  fetch('./data/estados-canales.json', { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error('Estados no disponibles');
    return r.json();
  }).then(data => {
    estadosCanales = new EstadosCanales(data);
    if (estado.actual) {
      estado.actual.minimoConfirmacionMs = estadosCanales.minimoMs(estado.actual);
      if (reproductor.canal?.url === estado.actual.url) reproductor.canal.minimoConfirmacionMs = estado.actual.minimoConfirmacionMs;
    }
    estado.version++;
    aplicarFiltros();
    actualizarFicha();
  }).catch(() => { /* Las fuentes permanecen sin verificar y disponibles. */ });
  const epg = new GuiaEPG({ memoria: Memoria, onCambio: alCambiarEpg });
  const agenda = new AgendaFutbol({ memoria: Memoria, onCambio: () => pintarAgenda() });

  /* ---------------- 2. Utilidades ---------------- */

  // Todo texto de la lista se escapa antes de ir al HTML: una lista maliciosa no puede inyectar código.
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  const fmtNum = new Intl.NumberFormat('es');
  const fmtHora = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
  const esMovil = () => window.matchMedia('(max-width: 1023px)').matches;
  function indicadorSenal(c) {
    const s = estadosCanales.resolver(c, verificador.estado(c.url));
    if (s.estado === 'sin-verificar' && saludDestacados.get(c.url)?.ok) {
      return '<span class="insignia estado-senal" title="Manifiesto HLS accesible; reproducción sostenida pendiente">HLS verificado</span>';
    }
    return `<span class="insignia estado-senal" data-estado="${s.estado}" title="${esc(s.motivo)}">${s.etiqueta}</span>`;
  }
  function medirUnaVez(nombre, intento, parametros) {
    const clave = `${nombre}:${intento}`;
    if (estado.eventosMedidos.has(clave)) return;
    estado.eventosMedidos.add(clave);
    if (estado.eventosMedidos.size > 96) estado.eventosMedidos.delete(estado.eventosMedidos.values().next().value);
    Analitica.evento(nombre, parametros);
  }

  /** Hash corto y estable (djb2) para ids. */
  function hash(texto) {
    let h = 5381;
    for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function toast(mensaje, tipo = 'info', ms = 4000) {
    while (dom.toasts.children.length >= 3) dom.toasts.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.textContent = mensaje;
    dom.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  /** "ESPN 2" → "ESPN 2", "Canal 13" → "C13", "TyC Sports" → "TYC". */
  function iniciales(nombre) {
    const p = normalizar(nombre).split(' ').filter(Boolean);
    if (!p.length) return '?';
    const corta = p[0].length <= 4;
    if (p[1] && /^\d+$/.test(p[1])) return `${corta ? `${p[0]} ` : p[0][0]}${p[1]}`.toUpperCase();
    return (corta ? p[0] : p[0].slice(0, 3)).toUpperCase();
  }

  /** Resalta las palabras buscadas (al inicio de palabra) respetando tildes del original. */
  function resaltar(texto, tokens) {
    const s = String(texto ?? '');
    if (!tokens.length || !s) return esc(s);
    const chars = [...s];
    let norm = '';
    const origen = [];
    chars.forEach((c, i) => {
      const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
      for (const x of n) { norm += x; origen.push(i); }
    });
    const marcado = new Array(chars.length).fill(false);
    for (const tk of tokens) {
      for (let pos = norm.indexOf(tk); pos !== -1; pos = norm.indexOf(tk, pos + 1)) {
        if (pos > 0 && norm[pos - 1] !== ' ') continue;
        for (let k = pos; k < pos + tk.length; k++) marcado[origen[k]] = true;
      }
    }
    let html = '';
    let abierto = false;
    chars.forEach((c, i) => {
      if (marcado[i] !== abierto) { html += abierto ? '</mark>' : '<mark>'; abierto = marcado[i]; }
      html += esc(c);
    });
    return abierto ? `${html}</mark>` : html;
  }

  /* ---------------- 3. Favoritos ----------------
     Se guarda una ficha completa de cada canal (no solo la URL), así la
     pestaña ⭐ Favoritos muestra tus canales aunque cambies de lista.
  ------------------------------------------------- */

  const CAMPOS_FAVORITO = ['url', 'nombre', 'calidad', 'etiquetas', 'geobloqueado', 'no247', 'grupos',
    'logo', 'formato', 'compatible', 'pais', 'referrer', 'userAgent', 'busqueda'];

  function fichaFavorito(c, guardado = Date.now()) {
    const f = { guardado };
    for (const k of CAMPOS_FAVORITO) f[k] = c[k];
    return f;
  }

  function cargarFavoritos() {
    const crudo = Memoria.leer('favoritos', []);
    const mapa = new Map();
    for (const f of Array.isArray(crudo) ? crudo : []) {
      if (typeof f === 'string') mapa.set(f, { url: f });   // formato antiguo: solo la URL
      else if (f && typeof f.url === 'string') mapa.set(f.url, f);
    }
    return mapa;
  }

  const guardarFavoritos = () => Memoria.guardar('favoritos', [...estado.favoritos.values()]);

  /** Reconstruye un canal a partir de su ficha guardada (revalidando URLs por seguridad). */
  function canalDesdeFavorito(f) {
    let url;
    try { url = validarUrl(f.url).href; } catch { return null; }
    let logo = null;
    try { if (f.logo) logo = validarUrl(f.logo).href; } catch { /* logo inválido: se ignora */ }
    const nombre = String(f.nombre || new URL(url).hostname);
    const grupos = Array.isArray(f.grupos) && f.grupos.length ? f.grupos.map(String) : ['Undefined'];
    const busqueda = typeof f.busqueda === 'string' ? f.busqueda : normalizar(`${nombre} ${grupos.join(' ')}`);
    const canal = {
      id: `fav-${hash(url)}`,
      url, nombre, logo, grupos, busqueda,
      calidad: f.calidad || null,
      etiquetas: Array.isArray(f.etiquetas) ? f.etiquetas : [],
      geobloqueado: !!f.geobloqueado,
      no247: !!f.no247,
      formato: f.formato || 'desconocido',
      compatible: f.compatible !== false,
      pais: f.pais || '',
      referrer: f.referrer || null,
      userAgent: f.userAgent || null,
      externo: true, // no pertenece a la lista cargada
    };
    canal.cats = clasificar(canal);
    return canal;
  }

  /** Favoritos de la lista actual (en su orden) + favoritos guardados de otras listas. */
  function canalesFavoritos() {
    const enLista = estado.canales.filter((c) => estado.favoritos.has(c.url));
    const urls = new Set(enLista.map((c) => c.url));
    const externos = [...estado.favoritos.values()]
      .filter((f) => !urls.has(f.url))
      .sort((a, b) => (b.guardado || 0) - (a.guardado || 0))
      .map(canalDesdeFavorito)
      .filter(Boolean);
    return [...enLista, ...externos];
  }

  function alternarFavorito(c) {
    if (!c) return;
    const quitar = estado.favoritos.has(c.url);
    if (quitar) estado.favoritos.delete(c.url);
    else estado.favoritos.set(c.url, fichaFavorito(c));
    guardarFavoritos();
    estado.version++; // la vista Favoritos cambió

    if (estado.filtro === 'favoritos') aplicarFiltros();
    else { refrescarTarjeta(c); actualizarContadores(); }
    if (estado.actual?.url === c.url) actualizarFicha();
    toast(quitar ? `«${c.nombre}» quitado de favoritos.` : `⭐ «${c.nombre}» agregado a favoritos.`, quitar ? 'info' : 'ok', 2500);
  }

  /* ---------------- 4. Carga de listas ---------------- */

  function mostrarProgreso(texto, porcentaje) {
    dom.estadoCarga.hidden = false;
    dom.textoCarga.textContent = texto;
    dom.barraCarga.classList.toggle('indeterminada', porcentaje == null);
    if (porcentaje != null) dom.barraCarga.style.width = `${porcentaje}%`;
  }

  function bloquearFormulario(bloquear) {
    [dom.btnCargar, dom.btnDefecto, dom.selPreset].forEach((el) => { el.disabled = bloquear; });
  }

  /** Clave de caché: la URL ya normalizada (o el texto tal cual si no es válida). */
  function claveLista(textoUrl) {
    try { return prepararUrlLista(textoUrl).href; } catch { return String(textoUrl).trim(); }
  }

  /** Lista en caché si es reciente (para abrirla al instante desde una pestaña). */
  function leerCache(clave) {
    const e = estado.cache.get(clave);
    if (!e || Date.now() - e.hora > CONFIG.cacheMinutos * 60_000) return null;
    return e.resultado;
  }

  function guardarCache(clave, resultado) {
    // Cada canal recuerda de qué lista viene (la búsqueda global lo muestra).
    for (const c of resultado.canales) c.lista = resultado.url;
    estado.cache.delete(clave);
    estado.cache.set(clave, { resultado, hora: Date.now() });
    // "Mis listas" y la lista activa se conservan siempre; del resto, solo las más recientes
    // (una lista mundial ocupa varios MB de memoria).
    const protegidas = new Set([...estado.misListas.map((l) => l.url), estado.listaUrl, clave]);
    const libres = [...estado.cache.keys()].filter((k) => !protegidas.has(k));
    while (libres.length > CONFIG.cacheMaxListas) estado.cache.delete(libres.shift());
  }

  /**
   * Carga una lista (descarga + análisis en segundo plano).
   * @param {{ forzar?: boolean }} opciones  forzar = ignorar la caché (botón "Cargar lista")
   */
  async function cargar(textoUrl, { forzar = false } = {}) {
    // Cualquier lista se puede abrir, incluso con un video en curso: la elige el usuario.
    estado.carga?.abort(); // cancela una descarga anterior
    estado.ultimaUrl = textoUrl;
    dom.errorCarga.hidden = true;

    const clave = claveLista(textoUrl);
    const enCache = !forzar && leerCache(clave);
    if (enCache) {
      // Si había otra descarga en curso, se canceló arriba: se limpia su indicador aquí.
      estado.carga = null;
      dom.estadoCarga.hidden = true;
      bloquearFormulario(false);
      aplicarLista({ ...enCache, desdeCache: true });
      return;
    }

    const ctrl = new AbortController();
    estado.carga = ctrl;
    if (textoUrl === CONFIG.listaPorDefecto) return cargarCatalogoPro(ctrl, clave);
    bloquearFormulario(true);
    marcarPestana(clave, true);

    let host = '';
    try { host = prepararUrlLista(textoUrl).hostname; } catch { /* el error real lo da cargarLista */ }
    mostrarProgreso(`Conectando con ${host || 'el servidor'}…`, null);

    try {
      const resultado = await cargarLista(textoUrl, {
        signal: ctrl.signal,
        onDescarga: (bytes, total) => {
          const kb = fmtNum.format(Math.round(bytes / 1024));
          mostrarProgreso(
            total ? `Descargando lista · ${kb} de ${fmtNum.format(Math.round(total / 1024))} KB` : `Descargando lista · ${kb} KB`,
            total ? Math.min(100, (bytes / total) * 100) : null
          );
        },
        onAnalisis: (hechas, total) => {
          const pct = total ? Math.round((hechas / total) * 100) : null;
          mostrarProgreso(`Analizando canales${pct != null ? ` · ${pct}%` : '…'}`, pct);
        },
      });
      if (estado.carga !== ctrl) return; // llegó otra carga más nueva
      resultado.canales = resultado.canales.filter(esHlsInterno).slice(0, CONFIG.maxCanales);
      resultado.epgUrls = []; // no descarga guías adicionales durante la reproducción
      guardarCache(clave, resultado);
      aplicarLista(resultado);
    } catch (err) {
      if (estado.carga !== ctrl || err.codigo === 'cancelado') return;
      console.warn('[IPTV] Error al cargar la lista:', err);
      dom.textoErrorCarga.textContent = err.message || 'Error desconocido al cargar la lista.';
      dom.errorCarga.hidden = false;
    } finally {
      if (estado.carga === ctrl) {
        estado.carga = null;
        dom.estadoCarga.hidden = true;
        bloquearFormulario(false);
        marcarPestana(estado.listaUrl);
      }
    }
  }

  /** Catálogo curado: un JSON pequeño con canales ya analizados y comprobados (sin barra de progreso). */
  async function cargarCatalogoPro(ctrl, clave) {
    try {
      const t0 = performance.now();
      // Mismo modo que el <link rel=preload> del <head>: reutiliza esa descarga (iniciada antes que los scripts).
      const r = await fetch(CONFIG.listaPorDefecto, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!Array.isArray(d.canales)) throw new Error('Catálogo no válido');
      if (estado.carga !== ctrl) return;
      // La comprobación del servidor vale como estado inicial solo si es reciente (72 h).
      if (Date.now() - Date.parse(d.generado) < 72 * 3600_000) {
        for (const c of d.canales) {
          if (c.salud?.ok && !saludDestacados.has(c.url)) {
            saludDestacados.set(c.url, { ok: true, motivo: 'manifiesto HLS válido', respuestaMs: c.salud.respuestaMs, servidor: d.generado });
          }
        }
      }
      const resultado = { url: CONFIG.listaPorDefecto, urlFinal: r.url || CONFIG.listaPorDefecto, canales: d.canales.filter(esHlsInterno).slice(0, CONFIG.maxCanales),
        grupos: d.grupos || [], duplicados: 0, descartados: 0, directo: false, epgUrls: [], motor: 'precompilado',
        msAnalisis: Math.round(performance.now() - t0), silencioso: true };
      guardarCache(clave, resultado);
      aplicarLista(resultado);
    } catch (err) {
      if (estado.carga !== ctrl || err.name === 'AbortError') return;
      dom.textoErrorCarga.textContent = 'No se pudo cargar el catálogo. Revisa tu conexión y vuelve a intentarlo.';
      dom.errorCarga.hidden = false;
    } finally {
      if (estado.carga === ctrl) { estado.carga = null; marcarPestana(estado.listaUrl); }
    }
  }

  // Solo streams HLS. No se crean canales a partir de páginas web.
  let senalesPartido = [null, null, null];
  const candidatosPartido = [[], [], []];
  const saludDestacados = new Map();
  const comprobandoDestacados = new Set();
  const fallosCadena = new Set();
  const catalogoServidores = new Map();
  const canalCompartido = new URLSearchParams(location.search).get('canal');
  let pendienteCompartido = !!canalCompartido;
  let prioridadVideo = true;
  let ctrlDestacados = null;
  let ctrlIndice = null;
  let tRespaldo = null;
  let intentoRespaldo = null;
  let comprobacionEnCurso = false;
  const botonesSenal = [...document.querySelectorAll('[data-senal]')];
  const avisoRespaldo = document.querySelector('#respaldo-partido');
  const estadoSenales = document.querySelector('#estado-senales');
  const emergenciaSenal = document.querySelector('#emergencia-senal');

  function esHlsInterno(c) {
    try {
      const u = new URL(c?.url);
      // Muchos streams HLS no terminan en .m3u8 (.php, /playlist, /live…): el reproductor los detecta al abrirlos.
      return c.compatible !== false && /^https?:$/.test(u.protocol)
        && !(location.protocol === 'https:' && u.protocol === 'http:');
    } catch { return false; }
  }

  // El titular solo anuncia un partido si la agenda tiene uno en juego (antes decía «Libertadores» cada día a las 18:30).
  function actualizarModoChile() {
    const t = Date.now();
    const vivo = agenda.hoy(t).find((e) => AgendaFutbol.estadoReal(e, t) === 'vivo');
    document.querySelector('#titulo-partido-hoy').textContent = vivo ? `En juego: ${vivo.local} vs ${vivo.visita}` : 'Señales en vivo';
    document.querySelector('#partido-hoy').classList.toggle('modo-partido', !!vivo);
  }

  function crearDestacado(opcion, grupo, respaldo = false) {
    const c = window.ParserM3U.parsear(`#EXTM3U\n#EXTINF:-1 group-title="Sports",${opcion.nombre}\n${opcion.url}`, location.href).canales[0];
    if (!c) return null;
    c.id = `destacado-${grupo}-${hash(c.url)}`;
    c.grupoPartido = grupo;
    c.respaldoDestacado = respaldo;
    return c;
  }

  function grupoDeCanal(c) {
    const n = normalizar(c.nombre);
    if (/\bespn\b/.test(n)) return 0;
    if (/chilevision|\bchv\b|\bmichv\b/.test(n)) return 1;
    if (/pluto.*(deport|esport|sport|competition)|paramount|fox sports|telefe/.test(n)) return 2;
    return -1;
  }

  function prioridadDestacado(c, i) {
    if (c.respaldoDestacado) return 100 + (/^espn 5/.test(normalizar(c.nombre)) ? 1 : 0);
    const n = normalizar(c.nombre);
    const patrones = i === 0 ? [/^espn(?: latin|$)/, /^espn 2\b/, /^espn premium\b/, /^espn 3\b/]
      : i === 1 ? [/chilevision/, /\bchv\b/, /michv/]
      : [/pluto.*deport/, /pluto.*e sport/, /pluto.*esport/, /pluto/, /paramount/, /fox sports/, /telefe/];
    const j = patrones.findIndex(re => re.test(n));
    return j < 0 ? patrones.length : j;
  }

  function configurarSenales(canales) {
    for (const c of canales) if (esHlsInterno(c)) catalogoServidores.set(c.url, c);
    const top = [
      [CANALES_PARTIDO_HOY[0].opciones[0], CANALES_PARTIDO_HOY[0].opciones[3]],
      [CANALES_PARTIDO_HOY[1].respaldos[0], CANALES_PARTIDO_HOY[0].opciones[5]],
      [CANALES_PARTIDO_HOY[2].respaldos[0], CANALES_PARTIDO_HOY[2].respaldos[1]],
    ];
    top.forEach((opciones, i) => {
      const nuevos = opciones.map(o => crearDestacado(o, i));
      for (const c of nuevos) {
        if (!c || !esHlsInterno(c)) continue;
        if (!catalogoServidores.has(c.url)) catalogoServidores.set(c.url, c);
        if (!candidatosPartido[i].some(x => x.url === c.url)) candidatosPartido[i].push(c);
      }
    });
    senalesPartido = candidatosPartido.map(g => g.find(c => saludDestacados.get(c.url)?.ok) || g.find(c => saludDestacados.get(c.url)?.ok !== false) || null);
    fijarDestacados(canales);
    pintarSenales();
  }

  function fijarDestacados(canales = estado.canales) {
    const primeros = [...new Map(senalesPartido.filter(c => c && saludDestacados.get(c.url)?.ok).map(c => [c.url, c])).values()];
    const urls = new Set(primeros.map(c => c.url));
    const candidatos = new Set(candidatosPartido.flat().map(c => c.url));
    const otrosActivos = candidatosPartido.flat().filter(c => saludDestacados.get(c.url)?.ok && !urls.has(c.url));
    const todos = [...primeros, ...otrosActivos, ...candidatosPartido.flat(), ...canales.filter(esHlsInterno)];
    estado.canales = [...new Map(todos.map(c => [c.url, c])).values()].slice(0, CONFIG.maxCanales);
    estado.version++;
  }

  function pintarSenales() {
    botonesSenal.forEach((boton, i) => {
      const c = senalesPartido[i];
      const salud = saludDestacados.get(c?.url);
      boton.disabled = !c || salud?.ok === false;
      boton.setAttribute('aria-pressed', String(!!c && c.url === estado.actual?.url));
      boton.title = c?.nombre || 'Comprobando señales HLS y respaldos';
      const indicador = boton.querySelector('[data-salud]');
      const nombre = boton.querySelector('[data-nombre]');
      // Nombre corto para el selector («ESPN 2», no «ESPN 2 Latin America (1080p)»).
      if (nombre) nombre.textContent = c ? c.nombre.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+Latin America.*$/i, '') : 'Sin señal';
      boton.dataset.estado = c && salud?.ok ? 'activa' : comprobacionEnCurso ? 'verificando' : c ? 'disponible' : 'sin-senal';
      indicador.textContent = c && salud?.ok ? 'Activa' : comprobacionEnCurso ? 'Verificando' : c ? 'Disponible' : 'Sin señal';
    });
    estadoSenales.textContent = '';
  }

  function servidoresDelCanal(canal = estado.actual) {
    if (!canal) return [];
    return [...catalogoServidores.values()].filter(c => SenalesIPTV.mismoCanal(c, canal) && !c.geobloqueado && esHlsInterno(c))
      .sort((a, b) => SenalesIPTV.comparar(a, b, saludDestacados, verificador));
  }

  async function verificarDestacados() {
    if (comprobacionEnCurso || prioridadVideo || document.hidden) return;
    const ctrl = new AbortController();
    ctrlDestacados = ctrl;
    comprobacionEnCurso = true;
    pintarSenales();
    try {
      const cola = [...new Map(candidatosPartido.flat().map(c => [c.url, c])).values()].slice(0, 6)
        .filter(c => !saludDestacados.has(c.url));
      await Promise.all(Array.from({ length: Math.min(2, cola.length) }, async () => {
        while (cola.length && !ctrl.signal.aborted && !prioridadVideo) {
          const c = cola.shift();
          comprobandoDestacados.add(c.url);
          const r = await VerificadorCanales.probarStream(c, ctrl.signal);
          comprobandoDestacados.delete(c.url);
          if (ctrl.signal.aborted || prioridadVideo) break;
          // Una página HTML o una M3U sin etiquetas HLS no confirma un manifiesto.
          if (!saludDestacados.get(c.url)?.reproduciendo) {
            saludDestacados.set(c.url, { ...r, ok: r.ok && r.motivo === 'manifiesto HLS válido' });
          }
          seleccionarActivas();
        }
      }));
    } finally {
      comprobacionEnCurso = false;
      if (ctrlDestacados === ctrl) ctrlDestacados = null;
      pintarSenales();
      aplicarFiltros();
    }
  }

  function reservarRedVideo() {
    prioridadVideo = true;
    ctrlDestacados?.abort();
    estado.verificacion?.abort();
    ctrlIndice?.abort();
    // La lista que el usuario pidió sigue descargándose aunque el video arranque o haga buffering.
    dom.btnVerificar.disabled = true;
    dom.textoVerificar.textContent = 'Pausa el video para comprobar señales';
  }

  function seleccionarActivas() {
    const usados = new Set();
    senalesPartido = candidatosPartido.map((grupo, i) => {
      const actual = senalesPartido[i];
      if (estado.reproduciendo && actual?.url === estado.actual?.url && saludDestacados.get(actual.url)?.ok) {
        usados.add(actual.url); return actual;
      }
      const activos = grupo.filter(c => saludDestacados.get(c.url)?.ok && !fallosCadena.has(c.url));
      const elegida = activos.find(c => !usados.has(c.url)) || grupo.find(c => saludDestacados.get(c.url)?.ok !== false && !fallosCadena.has(c.url) && !usados.has(c.url)) || null;
      if (elegida) usados.add(elegida.url);
      return elegida;
    });
    fijarDestacados();
    pintarSenales();
    aplicarFiltros();
    if (pendienteCompartido) {
      const compartido = [...catalogoServidores.values()].find(c => SenalesIPTV.identidad(c) === canalCompartido
        && SenalesIPTV.verificado(SenalesIPTV.salud(c, saludDestacados, verificador)));
      if (compartido) { pendienteCompartido = false; ver(compartido, { origen: 'auto' }); }
    }
  }

  function mostrarEmergencia(canal, mensaje = '') {
    document.querySelector('#mensaje-emergencia').textContent = mensaje || 'Estamos buscando otro stream HLS. Puedes volver a comprobar las señales aquí mismo.';
    emergenciaSenal.hidden = false;
  }

  function cancelarRespaldo() {
    clearTimeout(tRespaldo); tRespaldo = null; intentoRespaldo = null;
  }

  function buscarRespaldo(canal) {
    return opcionesServidores(canal).find(c => c.url !== canal?.url && !fallosCadena.has(c.url)
      && SenalesIPTV.verificado(SenalesIPTV.salud(c, saludDestacados, verificador)))
      || candidatosPartido.flat().find(c => c.url !== canal?.url && !fallosCadena.has(c.url)
        && saludDestacados.get(c.url)?.ok !== false) || null;
  }

  function opcionesServidores(canal) {
    const mismo = servidoresDelCanal(canal);
    const otras = [...catalogoServidores.values()].filter(c => esHlsInterno(c) && !c.geobloqueado
      && SenalesIPTV.verificado(SenalesIPTV.salud(c, saludDestacados, verificador)))
      .sort((a, b) => SenalesIPTV.comparar(a, b, saludDestacados, verificador));
    return [...new Map([...mismo, ...otras].map(c => [c.url, c])).values()];
  }

  function programarRespaldo(canal, intento) {
    if (estado.actual?.url !== canal?.url || intentoRespaldo === intento) return;
    fallosCadena.add(canal.url);
    saludDestacados.set(canal.url, { ok: false });
    seleccionarActivas();
    const siguiente = buscarRespaldo(canal);
    mostrarEmergencia(canal, siguiente ? `🔄 Cambiando a ${siguiente.nombre}…` : 'No hay otra señal verificada disponible. Vuelve a comprobar las señales.');
    avisoRespaldo.textContent = 'Cambiar ahora al respaldo';
    avisoRespaldo.hidden = !siguiente;
    if (!siguiente) return;
    intentoRespaldo = intento;
    const url = canal.url;
    tRespaldo = setTimeout(() => {
      tRespaldo = null;
      if (estado.actual?.url !== url || reproductor.intentoCarga !== intento) return;
      const respaldo = buscarRespaldo(canal);
      if (respaldo) ver(respaldo, { origen: 'respaldo' });
    }, 0);
  }

  function siguienteSenal() {
    const siguiente = buscarRespaldo(estado.actual);
    if (siguiente) ver(siguiente, { origen: 'respaldo' });
    else mostrarEmergencia(estado.actual);
  }

  botonesSenal.forEach((boton, i) => boton.addEventListener('click', () => {
    if (senalesPartido[i] && esHlsInterno(senalesPartido[i])) ver(senalesPartido[i]);
  }));
  avisoRespaldo.addEventListener('click', siguienteSenal);
  document.querySelector('#chat-cambiar-servidor').addEventListener('click', () => {
    document.querySelector('#chat-oferta-servidor').hidden = true;
    if (estado.actual) {
      fallosCadena.add(estado.actual.url);
      siguienteSenal();
    }
  });
  window.addEventListener('golstream:reportar-corte', () => {
    const siguiente = buscarRespaldo(estado.actual);
    const oferta = document.querySelector('#chat-oferta-servidor');
    document.querySelector('#chat-oferta-texto').textContent = siguiente
      ? `¿Se cortó? Puedes cambiar ahora a ${siguiente.nombre}.`
      : 'No hay otra señal verificada disponible. Vuelve a comprobar las señales.';
    document.querySelector('#chat-cambiar-servidor').hidden = !siguiente;
    oferta.hidden = false;
  });
  document.querySelector('#reverificar-senales').addEventListener('click', () => {
    cancelarRespaldo(); fallosCadena.clear();
    for (const [url, salud] of saludDestacados) if (!salud.ok) saludDestacados.delete(url);
    if (prioridadVideo) { toast('Pausa el video para comprobar las señales sin consumir su conexión.'); return; }
    void verificarDestacados();
  });
  const btnCompartir = document.querySelector('#compartir-partido');
  if (btnCompartir) {
    btnCompartir.addEventListener('click', async () => {
      const url = new URL(location.origin + location.pathname);
      const datos = { title: 'Gambeta Auriverde TV', text: '⚽ Mira el partido en vivo en Gambeta Auriverde TV', url: url.href };
      if (navigator.share) {
        try { await navigator.share(datos); return; } catch { /* ignore */ }
      }
      try {
        await navigator.clipboard.writeText(url.href);
        toast('Enlace copiado al portapapeles.', 'ok');
      } catch { /* ignore */ }
    });
  }

  function aplicarLista(r) {
    const host = new URL(r.urlFinal).hostname;
    configurarSenales(r.canales);
    // (los canales caídos se recuerdan por URL durante la sesión, aunque se cambie de lista)
    estado.grupo = '';
    estado.listaUrl = r.url;
    estado.version++;

    // Conteos por categoría inteligente (para los chips), calculados una vez por lista.
    estado.conteos = Object.fromEntries(NOMBRES_CATEGORIA.map((k) => [k, 0]));
    for (const c of estado.canales) for (const k of c.cats) estado.conteos[k]++;

    // Memoria: cuántos canales tenía cada lista oficial (se muestra en su pestaña).
    const conteosListas = Memoria.leer('conteosListas', {}) || {};
    conteosListas[r.url] = r.canales.length;
    Memoria.guardar('conteosListas', conteosListas);
    marcarPestana(r.url);

    // Memoria: esta lista se abrirá sola la próxima vez.
    dom.inputLista.value = r.url;
    Memoria.guardar('ultimaLista', r.url);
    // La dirección de la página refleja la lista: se puede compartir o guardar en marcadores.
    const direccion = new URL(location.href);
    if (r.url === CONFIG.listaPorDefecto) direccion.searchParams.delete('lista'); // dirección limpia para compartir
    else direccion.searchParams.set('lista', r.url);
    history.replaceState(null, '', direccion.href);

    // Actualiza las fichas de favoritos con los datos más recientes de la lista.
    let cambiaron = false;
    for (const c of estado.canales) {
      const f = estado.favoritos.get(c.url);
      if (f) { estado.favoritos.set(c.url, fichaFavorito(c, f.guardado)); cambiaron = true; }
    }
    if (cambiaron) guardarFavoritos();

    // Si el canal que se está viendo existe en la nueva lista, se enlaza sin cortar la imagen.
    const mismo = estado.actual && estado.canales.find((c) => c.url === estado.actual.url);
    if (mismo) estado.actual = mismo;

    pintarGrupos(r.grupos);
    dom.selGrupo.disabled = false;
    dom.infoLista.textContent = r.silencioso ? `${fmtNum.format(r.canales.length)} canales verificados` : `${fmtNum.format(r.canales.length)} canales · ${host}`;
    actualizarBotonGuardar();
    pintarMisListas();
    // Guía de programación declarada por la propia lista (#EXTM3U x-tvg-url="…").
    if (r.epgUrls?.length) epg.agregarDesdeLista(r.epgUrls);
    if (!estado.actual) {
      dom.textoReposo.textContent = 'Elige un canal de la lista';
      dom.subtextoReposo.textContent = 'Usa ↑ ↓ del teclado, el buscador o el filtro Deportes.';
    }

    aplicarFiltros();
    pintarAgenda(); // la nueva lista puede tener el canal que transmite un partido
    if (!r.desdeCache) Analitica.evento('cargar_lista', { lista: LISTAS.find(l => l.url === r.url)?.id || 'personalizada', canales: r.canales.length });
    const extra = [
      r.duplicados ? `${fmtNum.format(r.duplicados)} duplicados fusionados` : '',
      r.descartados ? `${fmtNum.format(r.descartados)} enlaces no válidos descartados` : '',
    ].filter(Boolean).join(' · ');
    const detalleExtra = extra ? ` · ${extra}` : '';
    const origen = r.desdeCache
      ? 'desde memoria'
      : `analizada en ${fmtNum.format(r.msAnalisis)} ms${r.motor === 'worker' ? ' en segundo plano' : ''}`;
    // El catálogo por defecto entra en silencio: nada de avisos técnicos en los primeros segundos.
    if (!r.silencioso) toast(`Lista cargada: ${fmtNum.format(r.canales.length)} canales en ${fmtNum.format(r.grupos.length)} categorías (${origen})${detalleExtra}.`, 'ok');

    // Con la lista activa lista, se preparan en segundo plano las demás de "Mis listas".


    if (r.directo) return ver(estado.canales[0]); // pegaron un .m3u8 directo: reproducir ya

    // Memoria: como un televisor, se retoma el último canal visto.
    const ultimo = !estado.actual && Memoria.leer('ultimoCanal');
    const canal = ultimo && estado.canales.find((c) => c.url === ultimo);
    if (canal) {
      ver(canal, { origen: 'auto' });
      toast(`Continuando con «${canal.nombre}».`, 'info', 3000);
    }
  }

  /** @param {Array<[string, number]>} grupos  categorías exactas de la lista, de mayor a menor */
  function pintarGrupos(grupos) {
    const opciones = grupos.map(([g, n]) => `<option value="${esc(g)}">${esc(traducirGrupo(g))} (${fmtNum.format(n)})</option>`);
    dom.selGrupo.innerHTML = `<option value="">Todas las categorías de la lista</option>${opciones.join('')}`;
  }

  /* ---------- Pestañas y menús de listas oficiales ---------- */

  function pintarFuentes() {
    const prioritarias = ['todos', 'nexus', 'deportes', 'co', 'ar', 'cl'];
    const secundarias = ['es', 'br', 'pe', 'it', 'uk', 'spa', 'noticias'];
    const boton = (l) => `
      <button type="button" class="pestana" role="tab" aria-selected="false" data-url="${esc(l.url)}" title="${esc(l.detalle)}">
        <span class="pestana-nombre">${esc(l.nombre)}</span>
        <span class="pestana-cuenta"></span>
      </button>`;
    dom.pestanas.innerHTML = `
      <div class="categorias-principales" role="presentation">
        ${prioritarias.map(id => LISTAS.find(l => l.id === id)).filter(Boolean).map(boton).join('')}
        <button type="button" id="btn-mas-paises" class="btn-mas-paises-derecha" aria-expanded="false" aria-controls="caja-categorias-secundarias">
          + Más países y listas
        </button>
      </div>
      <div id="caja-categorias-secundarias" class="categorias-secundarias" role="presentation" hidden>
        ${[...secundarias.map(id => LISTAS.find(l => l.id === id)).filter(Boolean), ...LISTAS.filter(l => !prioritarias.includes(l.id) && !secundarias.includes(l.id))].map(boton).join('')}
      </div>`;

    const btnMasPaises = dom.pestanas.querySelector('#btn-mas-paises');
    const cajaSecundarias = dom.pestanas.querySelector('#caja-categorias-secundarias');
    if (btnMasPaises && cajaSecundarias) {
      btnMasPaises.addEventListener('click', (e) => {
        e.stopPropagation();
        const abierto = !cajaSecundarias.hidden;
        cajaSecundarias.hidden = abierto;
        btnMasPaises.setAttribute('aria-expanded', String(!abierto));
        btnMasPaises.textContent = abierto ? '+ Más países y listas' : '− Menos países y listas';
      });
    }

    dom.atajos.innerHTML = LISTAS.map((l) =>
      `<button type="button" class="chip" data-url="${esc(l.url)}" title="${esc(l.detalle)}">${esc(l.nombre)}</button>`).join('');

    const grupos = [...new Set(LISTAS_EXTRA.map((l) => l.grupo))];
    dom.selPreset.innerHTML = '<option value="">Más listas…</option>' + grupos.map((g) =>
      `<optgroup label="${esc(g)}">${LISTAS_EXTRA.filter((l) => l.grupo === g)
        .map((l) => `<option value="${esc(l.url)}">${esc(l.nombre)}</option>`).join('')}</optgroup>`).join('');
  }

  /** Marca la pestaña de la lista activa (o la que se está cargando) y muestra cuántos canales tenía. */
  function marcarPestana(url, cargando = false) {
    const conteos = Memoria.leer('conteosListas', {}) || {};
    const botones = [...dom.pestanas.querySelectorAll('[data-url]')];
    const seleccion = botones.find(b => b.dataset.url === url) || botones[0];
    botones.forEach((b) => {
      const activa = b.dataset.url === url;
      b.setAttribute('aria-selected', String(activa));
      b.tabIndex = b === seleccion ? 0 : -1;
      b.disabled = cargando && !activa;
      const n = conteos[b.dataset.url];
      b.querySelector('.pestana-cuenta').textContent = n ? fmtNum.format(n) : '';
      if (activa && cargando) b.querySelector('.pestana-cuenta').textContent = '…';
    });
    // Las dos filas se adaptan al ancho; seleccionar una lista nunca desplaza ni oculta países.
  }

  /* ---------------- 5. Mis listas y búsqueda global ----------------
     El usuario guarda varias URLs de listas. Se descargan en segundo plano
     (en el Worker) y el buscador las recorre todas: los canales que no están
     en la lista activa aparecen en "En otras listas", con su lista de origen.
  ------------------------------------------------------------------- */

  /** Nombre legible de una lista: el de la pestaña oficial, el guardado por el usuario o el del archivo. */
  function nombreLista(url) {
    const oficial = LISTAS.find((l) => l.url === url);
    if (oficial) return `${oficial.emoji} ${oficial.nombre}`;
    const extra = LISTAS_EXTRA.find((l) => l.url === url);
    if (extra) return extra.nombre;
    const mia = estado.misListas.find((l) => l.url === url);
    if (mia) return mia.nombre;
    try {
      const u = new URL(url);
      let archivo = u.pathname.split('/').filter(Boolean).pop() || '';
      try { archivo = decodeURIComponent(archivo); } catch { /* nombre con % inválido */ }
      archivo = archivo.replace(/\.(m3u8?|txt)$/i, '');
      return archivo ? `${archivo} · ${u.hostname}` : u.hostname;
    } catch {
      return url;
    }
  }

  const guardarMisListas = () => Memoria.guardar('misListas', estado.misListas);
  const esMiLista = (url) => estado.misListas.some((l) => l.url === url);

  function actualizarBotonGuardar() {
    const guardada = esMiLista(estado.listaUrl);
    dom.btnGuardarLista.disabled = !estado.listaUrl;
    dom.btnGuardarLista.setAttribute('aria-pressed', String(guardada));
    dom.textoGuardarLista.textContent = guardada ? 'Guardada' : 'Guardar';
    dom.btnGuardarLista.title = guardada ? 'Quitar esta lista de Mis listas' : 'Guardar esta lista en Mis listas (para la búsqueda global)';
  }

  function alternarGuardarLista() {
    const url = estado.listaUrl;
    if (!url) return;
    if (esMiLista(url)) {
      quitarMiLista(url);
      return;
    }
    estado.misListas.push({ url, nombre: nombreLista(url) });
    guardarMisListas();
    actualizarBotonGuardar();
    pintarMisListas();
    actualizarEstadoGlobal();
    toast(`«${nombreLista(url)}» guardada en Mis listas.`, 'ok', 2500);
  }

  function quitarMiLista(url) {
    const nombre = nombreLista(url);
    estado.misListas = estado.misListas.filter((l) => l.url !== url);
    estado.erroresListas.delete(url);
    guardarMisListas();
    actualizarBotonGuardar();
    pintarMisListas();
    actualizarEstadoGlobal();
    if (estado.tokens.length) aplicarFiltros();
    toast(`«${nombre}» quitada de Mis listas.`, 'info', 2500);
  }

  function pintarMisListas() {
    if (!estado.misListas.length) {
      dom.misListas.innerHTML = '<span>Mis listas: pulsa <b class="text-slate-300">☆ Guardar</b> en una lista para buscar en todas a la vez.</span>';
      return;
    }
    dom.misListas.innerHTML = '<span class="mr-1">Mis listas:</span>' + estado.misListas.map((l) => {
      const r = estado.cache.get(l.url)?.resultado;
      const error = estado.erroresListas.get(l.url);
      const cuenta = error ? '⚠' : r ? fmtNum.format(r.canales.length) : estado.indexando === l.url ? '…' : '';
      return `
        <span class="mi-lista${l.url === estado.listaUrl ? ' activa' : ''}">
          <button type="button" data-accion="abrir" data-url="${esc(l.url)}" title="${esc(error || l.url)}">${esc(l.nombre)}<span class="mi-lista-cuenta">${cuenta}</span></button>
          <button type="button" data-accion="quitar" data-url="${esc(l.url)}" aria-label="Quitar ${esc(l.nombre)} de Mis listas" title="Quitar de Mis listas">×</button>
        </span>`;
    }).join('');
  }

  /** Descarga en segundo plano (una a una) las listas guardadas que aún no están en memoria. */
  let indexandoListas = false;
  async function indexarMisListas() {
    if (indexandoListas || prioridadVideo) return;
    const ctrl = new AbortController();
    ctrlIndice = ctrl;
    indexandoListas = true;
    try {
      for (const l of [...estado.misListas]) {
        if (prioridadVideo || ctrl.signal.aborted) break;
        if (estado.cache.has(l.url) || estado.erroresListas.has(l.url) || !esMiLista(l.url)) continue;
        estado.indexando = l.url;
        pintarMisListas();
        actualizarEstadoGlobal();
        try {
          const r = await cargarLista(l.url, { signal: ctrl.signal });
          if (prioridadVideo || ctrl.signal.aborted) break;
          r.canales = r.canales.slice(0, CONFIG.maxCanales);
          guardarCache(r.url, r);
          if (estado.tokens.length) aplicarFiltros(); // resultados nuevos para la búsqueda en curso
        } catch (err) {
          estado.erroresListas.set(l.url, `No se pudo cargar: ${err.message}`);
        }
      }
    } finally {
      if (ctrlIndice === ctrl) ctrlIndice = null;
      indexandoListas = false;
      estado.indexando = null;
      pintarMisListas();
      actualizarEstadoGlobal();
    }
  }

  /** Listas que recorre la búsqueda global: Mis listas + las abiertas en esta sesión (sin la activa). */
  function fuentesGlobales() {
    const urls = new Set([...estado.misListas.map((l) => l.url), ...estado.cache.keys()]);
    urls.delete(estado.listaUrl);
    return [...urls].map((url) => estado.cache.get(url)?.resultado).filter(Boolean);
  }

  function actualizarEstadoGlobal() {
    const fuentes = fuentesGlobales();
    const canales = fuentes.reduce((n, r) => n + r.canales.length, 0);
    if (estado.indexando) {
      const i = estado.misListas.findIndex((l) => l.url === estado.indexando) + 1;
      dom.estadoGlobal.textContent = `(cargando ${i}/${estado.misListas.length}…)`;
    } else {
      dom.estadoGlobal.textContent = fuentes.length
        ? `(${fuentes.length} ${fuentes.length === 1 ? 'lista' : 'listas'} · ${fmtNum.format(canales)} canales)`
        : '(guarda listas con ☆)';
    }
  }

  /** Canales de otras listas que coinciden con la búsqueda (sin repetir URLs ya visibles). */
  function buscarGlobal() {
    if (!estado.buscarGlobal || !estado.tokens.length || estado.filtro === 'favoritos') return { lista: [], total: 0 };
    const vistos = new Set(estado.filtrados.map((c) => c.url));
    const lista = [];
    let total = 0;
    for (const r of fuentesGlobales()) {
      for (const c of r.canales) {
        if (vistos.has(c.url) || !pasaFiltros(c, { global: true })) continue;
        vistos.add(c.url);
        total++;
        if (lista.length < CONFIG.maxGlobales) lista.push(c);
      }
    }
    return { lista, total };
  }

  function pintarGlobales() {
    const { lista, total } = estado.globales;
    dom.seccionGlobal.hidden = lista.length === 0;
    dom.cuentaGlobal.textContent = total > lista.length
      ? `(${fmtNum.format(lista.length)} de ${fmtNum.format(total)} · afina la búsqueda para ver el resto)`
      : `(${fmtNum.format(total)})`;
    dom.listaGlobal.innerHTML = lista.map((c) => tarjeta(c, -1, { global: true })).join('');
  }

  /* ---------------- 6. Filtros y lista de canales ---------------- */

  /** ¿"tk" está al inicio de alguna palabra de "texto"? */
  const empiezaPalabra = (texto, tk) => texto.startsWith(tk) || texto.includes(` ${tk}`);

  /**
   * @param {{ global?: boolean }} opciones  global: canal de otra lista (la categoría exacta del
   *   selector es propia de la lista activa, así que no se aplica)
   */
  function pasaFiltros(c, { global = false } = {}) {
    if (!esHlsInterno(c)) return false;
    if (estado.filtro !== 'todos' && estado.filtro !== 'favoritos' && !c.cats.includes(estado.filtro)) return false;
    if (!global && estado.grupo && !c.grupos.includes(estado.grupo)) return false;
    if (estado.ocultarGeo && c.geobloqueado) return false;
    if (estado.ocultarMuertos && (verificador.estado(c.url)?.ok === false
      || saludDestacados.get(c.url)?.ok === false
      || estadosCanales.resolver(c, verificador.estado(c.url)).estado === 'temporal')) return false;
    // Cada palabra buscada debe estar al inicio de alguna palabra del canal…
    // …o del programa que emite ahora o en las próximas horas (si hay guía cargada).
    return estado.tokens.every((tk) => empiezaPalabra(c.busqueda, tk) || (epg.activa && empiezaPalabra(epg.textoBusqueda(c), tk)));
  }

  /**
   * Recalcula la lista visible.
   * @param {{ incremental?: boolean }} opciones  Búsqueda incremental: si el texto nuevo solo
   *   agrega letras o palabras al anterior, se filtra sobre los resultados actuales
   *   (mucho menos trabajo con listas de miles de canales).
   */
  function aplicarFiltros({ incremental = false } = {}) {
    // La clave cubre todo lo que cambia el resultado además del texto (incluida la guía, que avanza con la hora).
    const clave = `${estado.version}|${estado.filtro}|${estado.grupo}|${estado.ocultarGeo}|${estado.ocultarMuertos}|${epg.version}|${Math.floor(Date.now() / 300_000)}`;
    const consulta = estado.tokens.join(' ');
    const reutilizar = incremental && clave === estado.previo.clave && consulta.startsWith(estado.previo.consulta);
    const base = reutilizar
      ? estado.filtrados
      : estado.filtro === 'favoritos' ? canalesFavoritos() : estado.canales;
    estado.filtrados = base.filter(pasaFiltros);
    estado.filtrados.sort((a, b) => SenalesIPTV.comparar(a, b, saludDestacados, verificador));
    estado.previo = { clave, consulta };
    estado.mostrados = 0;
    dom.lista.innerHTML = '';
    pintarMas();
    actualizarContadores();

    // Sin lista cargada se muestran los atajos de listas (salvo en Favoritos, que funciona sin lista).
    dom.panelVacio.hidden = !(estado.canales.length === 0 && estado.filtro !== 'favoritos');

    // Búsqueda global: lo que coincide en las otras listas.
    estado.globales = buscarGlobal();
    pintarGlobales();

    const vacio = dom.panelVacio.hidden && estado.filtrados.length === 0;
    dom.sinResultados.hidden = !vacio;
    if (vacio) {
      dom.sinResultados.textContent = estado.consulta.trim()
        ? estado.globales.total
          ? `«${estado.consulta.trim()}» no está en esta lista, pero sí en otras (abajo).`
          : `Ningún canal coincide con «${estado.consulta.trim()}».`
        : estado.filtro === 'favoritos'
          ? 'Aún no tienes favoritos. Toca la ⭐ de un canal (o pulsa S mientras lo ves) para guardarlo.'
          : 'No hay canales con estos filtros.';
    }

    const aVerificar = Math.min(estado.filtrados.length, CONFIG.maxVerificar);
    dom.btnVerificar.disabled = prioridadVideo || comprobacionEnCurso;
    dom.textoVerificar.textContent = prioridadVideo ? 'Pausa el video para comprobar señales' : 'Comprobar hasta 6 señales';
    actualizarNavegacion();
  }

  /** Dibuja la siguiente tanda de canales (evita meter miles de nodos de golpe). */
  function pintarMas() {
    const desde = estado.mostrados;
    const tanda = estado.filtrados.slice(desde, desde + CONFIG.lote);
    dom.lista.insertAdjacentHTML('beforeend', tanda.map((c, i) => tarjeta(c, desde + i)).join(''));
    estado.mostrados += tanda.length;
    const quedan = estado.mostrados < estado.filtrados.length;
    dom.centinela.hidden = !quedan;
    if (quedan) {
      // Re-observar fuerza un nuevo aviso si el centinela sigue visible.
      observador.unobserve(dom.centinela);
      observador.observe(dom.centinela);
    }
  }

  const observador = new IntersectionObserver((entradas) => {
    if (entradas[0].isIntersecting) pintarMas();
  }, { rootMargin: '600px 0px' });

  function actualizarContadores() {
    // Los conteos por categoría se calculan una vez al cargar la lista (estado.conteos).
    for (const el of dom.chips.querySelectorAll('[data-cuenta]')) {
      const k = el.dataset.cuenta;
      const n = k === 'favoritos' ? estado.favoritos.size : estado.conteos[k] || 0;
      el.textContent = n ? fmtNum.format(n) : '';
    }
    const total = estado.filtro === 'favoritos' ? estado.favoritos.size : estado.canales.length;
    dom.contador.textContent = total
      ? `${fmtNum.format(estado.filtrados.length)} de ${fmtNum.format(total)} ${estado.filtro === 'favoritos' ? 'favoritos' : 'canales'}`
      : '';
  }

  function insignias(c, { global = false } = {}) {
    const out = [indicadorSenal(c)];
    if (c.geobloqueado) out.push('<span class="insignia insignia-geo" title="Puede no estar disponible en tu país">Geo</span>');
    if (c.no247) out.push('<span class="insignia insignia-gris" title="No transmite las 24 horas">No 24/7</span>');
    if (!global && c.externo) out.push('<span class="insignia insignia-gris" title="Guardado desde otra lista">Otra lista</span>');
    return out.join('');
  }

  /** Línea "▶ programa" de la guía para una tarjeta (vacía si no hay guía para el canal). */
  function lineaEpg(c) {
    if (!epg.activa) return '';
    const p = epg.ahora(c)?.actual;
    return p ? `<span class="canal-epg" title="${esc(`${fmtHora.format(p.inicio)}–${fmtHora.format(p.fin)} · ${p.titulo}`)}">▶ ${resaltar(p.titulo, estado.tokens)}</span>` : '';
  }

  /**
   * @param {number} indice   posición en la lista visible (-1 en la búsqueda global)
   * @param {{ global?: boolean }} opciones
   */
  function tarjeta(c, indice, { global = false } = {}) {
    const t = estado.tokens;
    const activo = estado.actual?.id === c.id;
    const fav = estado.favoritos.has(c.url);
    const meta = [c.grupos.map(traducirGrupo).join(' · '), c.calidad, c.pais].filter(Boolean).join(' · ');
    // Hasta el primer cuadro de video los logos no se piden: el ancho de banda es del video.
    const logo = c.logo
      ? `<img data-logo ${logosActivos ? 'src' : 'data-src'}="${esc(c.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : '';
    return `
      <li class="canal${activo ? ' activo' : ''}${verificador.caido(c.url) ? ' caido' : ''}" data-id="${esc(c.id)}"${global ? ' data-global="1"' : ''}>
        <button type="button" class="canal-principal" data-accion="ver" aria-current="${activo}">
          <span class="canal-num" aria-hidden="true">${global ? '·' : indice + 1}</span>
          <span class="canal-logo" aria-hidden="true">${esc(iniciales(c.nombre))}${logo}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold text-white">${resaltar(c.nombre, t)}</span>
            <span class="mt-0.5 block truncate text-xs text-slate-500">${global && c.lista ? `<span class="insignia insignia-lista mr-1" title="Lista de origen">${esc(nombreLista(c.lista))}</span>` : ''}${resaltar(meta, t)}</span>
            ${lineaEpg(c)}
          </span>
          <span class="flex flex-col items-end gap-1">${insignias(c, { global })}</span>
        </button>
        <button type="button" class="canal-fav" data-accion="fav" aria-pressed="${fav}" aria-label="${fav ? 'Quitar de' : 'Agregar a'} favoritos: ${esc(c.nombre)}" title="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}">
          <svg viewBox="0 0 24 24" class="icono-estrella h-4 w-4" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>
        </button>
      </li>`;
  }

  const tarjetaEnPantalla = (c) => c && dom.lista.querySelector(`[data-id="${CSS.escape(c.id)}"]`);

  /** Vuelve a dibujar solo la tarjeta de un canal (en la lista y/o en la búsqueda global, si está en pantalla). */
  function refrescarTarjeta(c) {
    if (!c) return;
    const li = tarjetaEnPantalla(c);
    if (li) li.outerHTML = tarjeta(c, estado.filtrados.findIndex((x) => x.id === c.id));
    const lg = dom.listaGlobal.querySelector(`[data-id="${CSS.escape(c.id)}"]`);
    if (lg) lg.outerHTML = tarjeta(c, -1, { global: true });
  }

  /** Actualiza la línea "▶ programa" de las tarjetas visibles (la guía avanza con la hora). */
  function refrescarEpgVisible() {
    if (!epg.activa) return;
    const porId = new Map([...estado.filtrados.slice(0, estado.mostrados), ...estado.globales.lista].map((c) => [c.id, c]));
    for (const li of [...dom.lista.children, ...dom.listaGlobal.children]) {
      const c = porId.get(li.dataset.id);
      if (!c) continue;
      const span = li.querySelector('.canal-epg');
      const nuevo = lineaEpg(c);
      if (span) span.outerHTML = nuevo || '';
      else if (nuevo) li.querySelector('.canal-principal .min-w-0')?.insertAdjacentHTML('beforeend', nuevo);
    }
  }

  /* ---------------- 7. Verificador de enlaces ---------------- */

  /** Verifica los canales de la vista actual (o detiene la verificación en curso). */
  async function verificarVista() {
    if (prioridadVideo) return;
    return verificarDestacados();
  }

  /** Dibuja tandas hasta que el canal en la posición "indice" exista en el DOM. */
  function asegurarDibujado(indice) {
    while (indice >= estado.mostrados && estado.mostrados < estado.filtrados.length) pintarMas();
  }

  /* ---------------- 8. Reproductor, ficha, guía y OSD ---------------- */

  const reproductor = new ReproductorIPTV(dom.video, {
    onEstado: alCambiarEstado,
    onConfirmacionVideo: (canal, detalle) => {
      verificador.marcar(canal.url, true, 'reproduce correctamente', { confirmado: true, ...detalle });
      refrescarTarjeta(estado.actual?.url === canal.url ? estado.actual : canal);
      if (estado.actual?.url === canal.url) actualizarFicha();
    },
    onDiagnostico: d => medirUnaVez('sesion_video', d.intentoCarga, { pais: d.pais, fuente: /^iptv-org-[a-z]+$/.test(d.fuente) ? d.fuente : 'personalizada',
      inicio_ms: d.inicioVideoMs, buffering_ms: d.bufferingMs, congelamientos: d.congelamientos,
      reconexiones: d.reconexiones, resultado: d.resultado, duracion_ms: d.duracionMs }),
    onCalidades: pintarCalidades,
    onNivel: (nivel, auto) => {
      const n = estado.niveles.find((x) => x.indice === nivel);
      dom.selCalidad.options[0].textContent = auto && n?.alto ? `Auto (${n.alto}p)` : 'Auto';
    },
  }, HLS_ESTABLE);

  dom.video.addEventListener('play', reservarRedVideo);
  dom.video.addEventListener('pause', () => {
    if (!reproductor.terminal && reproductor.pausaUsuario) {
      prioridadVideo = false;
      aplicarFiltros();
      void verificarDestacados();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ctrlDestacados?.abort();
  });

  const gestoresTnt = new Map();
  const tntFecha = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function gestorTntActivo() {
    return estado.actual?.tntCanal ? gestoresTnt.get(estado.actual.tntCanal) : null;
  }

  function cancelarTntExcepto(idActivo = null) {
    for (const [id, gestor] of gestoresTnt) {
      if (id !== idActivo) gestor.cancelar();
    }
  }

  function crearGestorTnt(config) {
    const gestor = new GestorFuentesTNT({
      cargar: (canal) => ver(canal, { origen: 'auto' }),
      detener: () => reproductor.detener(),
      onCambio: pintarTnt,
    });
    gestor.configurar(config);
    gestoresTnt.set(gestor.id, gestor);
    return gestor;
  }

  function estadoTnt(gestor) {
    const activa = gestor.activa === null ? null : gestor.fuentes[gestor.activa];
    if (activa) return `${activa.nombre}: ${activa.estado}`;
    if (gestor.agotadas) return 'Ninguna fuente respondio. Consulta la plataforma oficial.';
    if (estado.actual && !estado.actual.tntFuente) return `Otro canal en el reproductor: ${estado.actual.nombre}`;
    return gestor.fuentes.some(f => f.habilitada) ? 'Sin fuente activa.' : 'Sin fuente activa. Fuentes no configuradas.';
  }

  function pintarTnt() {
    const caja = document.querySelector('#tnt-canales');
    if (!caja) return;
    if (!gestoresTnt.size) {
      caja.innerHTML = '<p class="text-xs text-slate-300" role="status">Configuracion no disponible. Fuentes no configuradas.</p>';
      return;
    }
    caja.innerHTML = [...gestoresTnt.values()].map((gestor) => {
      const oficial = gestor.plataformaOficial || '#';
      return `<article class="border-t border-linea pt-3 first:border-t-0 first:pt-0" data-tnt-canal="${esc(gestor.id)}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="truncate font-display text-base font-semibold text-white">${esc(gestor.canal)}</h3>
            <p class="text-xs text-slate-500">${esc(gestor.pais || 'Pais no informado')}</p>
          </div>
          <span class="text-xs text-slate-500">Fuente informativa</span>
        </div>
        <div class="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="Fuentes de ${esc(gestor.canal)}">
          ${gestor.fuentes.map((fuente, i) => `<button type="button" class="control justify-center text-xs ${gestor.activa === i ? 'text-cancha' : ''}" data-tnt-canal="${esc(gestor.id)}" data-tnt-fuente="${i}" aria-pressed="${gestor.activa === i}" ${fuente.habilitada ? '' : 'disabled'}>${esc(fuente.nombre)}</button>`).join('')}
        </div>
        <p class="mt-2 text-xs text-slate-300" role="status" aria-live="polite">${esc(estadoTnt(gestor))}</p>
        <ul class="mt-2 space-y-1 text-xs text-slate-500">
          ${gestor.fuentes.map(f => `<li><span class="${f.estado === 'reproduciendo' ? 'text-cancha' : f.estado === 'fallida' ? 'text-vivo' : ''}">${esc(f.nombre)}: ${esc(f.estado)}</span><br>Verificacion: ${f.ultimaVerificacion ? esc(tntFecha.format(new Date(f.ultimaVerificacion))) : 'sin datos'} | Fallo: ${esc(f.motivoFallo || 'ninguno registrado')}</li>`).join('')}
        </ul>
      </article>`;
    }).join('');
  }

  document.querySelector('#tnt-canales')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tnt-fuente][data-tnt-canal]');
    if (!btn || btn.disabled) return;
    const gestor = gestoresTnt.get(btn.dataset.tntCanal);
    if (!gestor) return;
    cancelarTntExcepto(gestor.id);
    gestor.iniciar(Number(btn.dataset.tntFuente));
  });
  pintarTnt();
  window.GolStreamTNT = Object.freeze({ gestores: gestoresTnt, get gestor() { return gestoresTnt.get('tnt-cl') || gestoresTnt.values().next().value; } });
  // Datos secundarios: se piden solo cuando su sección llega a la pantalla, nunca durante el arranque del video.
  function alVerSeccion(selector, fn) {
    const el = document.querySelector(selector);
    if (!el) return;
    new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { obs.disconnect(); fn(); } }).observe(el);
  }
  alVerSeccion('#tnt-catalogo', () => {
  fetch('./data/tnt-fuentes.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(config => {
    gestoresTnt.clear();
    const canales = Array.isArray(config.canales) ? config.canales : [config];
    canales.forEach(crearGestorTnt);
    pintarTnt();
  }).catch(() => {
    pintarTnt();
  });
  fetch('./data/deportes-reales.json', { cache: 'no-cache' }).then(r => r.json()).then(data => {
    const ev = data.eventos?.find(e => e.canalAnunciado === 'TNT Sports Premium' && e.fuenteCanal?.startsWith('https://tntsports.cl/'));
    if (!ev || !ev.inicio) return;
    const reciente = Date.now() - Date.parse(ev.consultado) <= 86400000;
    document.querySelector('#tnt-partido').textContent = `${reciente ? 'Ultimo anuncio comprobado' : 'Anuncio anterior, sin verificacion reciente'}: ${ev.local} vs ${ev.visita} | ${tntFecha.format(new Date(ev.inicio))} Chile | ${ev.estadoFuente}`;
  }).catch(() => {});
  });

  let logosActivos = false;
  function activarLogos() {
    if (logosActivos) return;
    logosActivos = true;
    for (const img of document.querySelectorAll('img[data-logo][data-src]')) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
  }
  setTimeout(activarLogos, 8000); // si el video no arranca, la lista no queda sin logos

  /** Una sola capa visible sobre el video: 'reposo' | 'cargando' | 'error' | null. */
  function capa(cual) {
    // El contenedor refleja el estado (skeleton de carga, error, reposo) sin botones sobre la imagen.
    dom.contenedorVideo.dataset.estado = cual || 'vivo';
    dom.capaReposo.hidden = cual !== 'reposo';
    dom.capaCargando.hidden = cual !== 'cargando';
    dom.capaError.hidden = cual !== 'error';
  }

  function alCambiarEstado(est, d, canal) {
    if (['cargando', 'reproduciendo', 'buffering', 'reconectando', 'recuperado'].includes(est)) reservarRedVideo();
    else if (['caido', 'detenido'].includes(est)) { prioridadVideo = false; aplicarFiltros(); }
    for (const gestor of gestoresTnt.values()) gestor.recibir(est, d, canal);
    const eraVivo = estado.reproduciendo;
    if (['fallo-fatal', 'caido'].includes(est)) {
      medirUnaVez('canal_caido', d.intentoCarga, { canal: canal.nombre, origen: 'reproductor' });
      programarRespaldo(canal, d.intentoCarga);
    } else if (['cargando', 'reproduciendo', 'recuperado', 'detenido', 'requiere-clic'].includes(est)) {
      cancelarRespaldo();
      avisoRespaldo.hidden = true;
      if (est === 'reproduciendo' && canal) {
        saludDestacados.set(canal.url, { ...saludDestacados.get(canal.url), ok: true, reproduciendo: true });
        pintarSenales();
      }
    }
    switch (est) {
      case 'cargando':
        capa('cargando');
        dom.textoCargando.textContent = `Conectando con ${canal.nombre}…`;
        estado.reproduciendo = false;
        break;
      case 'buffering':
        capa('cargando');
        dom.textoCargando.textContent = 'Cargando…';
        break;
      case 'reconectando':
        capa('cargando');
        dom.textoCargando.textContent = 'Reconectando…';
        break;
      case 'reproduciendo':
        capa(null);
        setTimeout(activarLogos, 1500);
        emergenciaSenal.hidden = true;
        estado.reproduciendo = true;
        if (!reproductor.videoConfirmado) verificador.marcar(canal.url, true, 'video iniciado; confirmación pendiente');
        // Estadísticas (js/analitica.js): un evento por canal que de verdad llegó a verse.
        medirUnaVez('ver_canal', d.intentoCarga, { canal_id: canal.id, pais: canal.pais, categoria: canal.cats?.[0] });
        break;
      case 'silenciado':
        break; // el botón «Activar sonido» bajo el video ya lo indica
      case 'requiere-clic':
        capa(null);
        toast('Toca ▶ en el video para iniciar.');
        break;
      case 'caido':
        capa('error');
        estado.reproduciendo = false;
        verificador.marcar(canal.url, false, d.motivo, d);
        medirUnaVez('canal_caido', d.intentoCarga, { canal: canal.nombre, origen: 'reproductor', pais: canal.pais, codigo: d.codigo,
          inicio_video: !!d.iniciado, reconexiones: d.reconexiones,
          http: d.http, tipo_hls: d.tipoHls, detalle_hls: d.detalleHls,
          fuente: /^iptv-org-[a-z]+$/.test(canal.fuente) ? canal.fuente : 'personalizada' });
        dom.textoError.textContent = `«${canal.nombre}»: ${d.motivo}.`;
        break;
      case 'detenido':
        capa('reposo');
        estado.reproduciendo = false;
        break;
    }
    if (canal && canal.url === estado.actual?.url && (eraVivo !== estado.reproduciendo || est === 'caido')) {
      refrescarTarjeta(estado.actual);
      actualizarFicha();
    }
  }

  function pintarCalidades(niveles) {
    estado.niveles = niveles;
    const opciones = [...niveles]
      .sort((a, b) => (b.alto || b.bitrate) - (a.alto || a.bitrate))
      .map((n) => `<option value="${n.indice}">${n.alto ? `${n.alto}p` : `${Math.round(n.bitrate / 1000)} kbps`}</option>`);
    dom.selCalidad.innerHTML = `<option value="-1">Auto</option>${opciones.join('')}`;
    dom.selCalidad.disabled = niveles.length < 2;
  }

  /** Datos y advertencias del canal actual bajo el video. */
  function actualizarFicha() {
    const c = estado.actual;
    if (!c) return;

    const oficial = accesoOficial(c);
    const estadoHtml = oficial ? '<span class="insignia insignia-gris">Acceso oficial</span>' : indicadorSenal(c);
    const posicion = estado.filtrados.findIndex((x) => x.id === c.id);
    const chips = [
      posicion >= 0 ? `Canal ${posicion + 1} de ${estado.filtrados.length}` : null,
      ...c.grupos.map(traducirGrupo), c.calidad, c.pais,
    ].filter(Boolean).map((x) => `<span class="insignia insignia-gris">${esc(x)}</span>`).join('');
    // Canal abierto desde la búsqueda global: se indica de qué lista viene.
    const deOtraLista = c.lista && c.lista !== estado.listaUrl
      ? `<span class="insignia insignia-lista" title="Lista de origen">${esc(nombreLista(c.lista))}</span>`
      : '';
    dom.fichaMeta.innerHTML = estadoHtml + deOtraLista + chips;
    dom.fichaTitulo.textContent = c.nombre;
    dom.fichaTitulo.title = c.nombre;
    dom.fichaUrl.textContent = oficial || c.url;
    dom.fichaUrl.title = oficial || c.url;

    // Advertencias útiles para entender por qué un canal podría no cargar.
    const avisos = [];
    if (c.geobloqueado) avisos.push('Marcado como geobloqueado: puede no estar disponible desde tu país.');
    if (c.no247) avisos.push('No transmite las 24 horas: puede estar fuera del aire en este momento.');
    if (c.referrer) avisos.push(`Este canal exige un «Referer» especial (${c.referrer}); los navegadores no permiten enviarlo, así que puede fallar.`);
    if (c.userAgent) avisos.push('Este canal pide un User-Agent específico que el navegador no puede imitar; puede fallar.');
    if (PAGINA_HTTPS && c.url.startsWith('http:')) avisos.push('Stream http:// en una página https://: el navegador lo bloqueará (contenido mixto).');
    dom.fichaAvisos.innerHTML = avisos.map((a) => `<li class="flex gap-2"><span aria-hidden="true">⚠</span><span>${esc(a)}</span></li>`).join('');
    dom.fichaAvisos.hidden = avisos.length === 0;
    const fav = estado.favoritos.has(c.url);
    dom.btnFavFicha.disabled = false;
    dom.btnFavFicha.setAttribute('aria-pressed', String(fav));
    dom.btnFavFicha.title = fav ? 'Quitar de favoritos (S)' : 'Agregar a favoritos (S)';
    dom.btnCopiar.disabled = !!oficial;
    document.title = `${c.nombre} · Gambeta Auriverde TV`;
    actualizarMediaSession(c);
    pintarFichaEpg();
  }

  /* ---------- Guía de programación (EPG) ---------- */

  /** Bloque "Ahora / A continuación" del canal actual. */
  function pintarFichaEpg() {
    const c = estado.actual;
    if (!c || !epg.activa) {
      dom.fichaEpg.hidden = true;
      return;
    }
    dom.fichaEpg.hidden = false;
    const p = epg.ahora(c);
    if (!p) {
      dom.fichaEpg.innerHTML = `<p class="text-xs text-slate-500">Este canal no aparece en las guías cargadas${c.tvgId ? ` (tvg-id: <code class="text-slate-400">${esc(c.tvgId)}</code>)` : ''}.</p>`;
      return;
    }
    const a = p.actual;
    const actual = a
      ? `<div class="flex items-center gap-2 text-xs">
           <span class="insignia insignia-vivo"><span class="live-dot"></span>Ahora</span>
           <span class="tabular-nums text-slate-400">${fmtHora.format(a.inicio)} – ${fmtHora.format(a.fin)}</span>
           ${a.categoria ? `<span class="insignia insignia-gris">${esc(a.categoria)}</span>` : ''}
           <span class="ml-auto tabular-nums text-slate-500">quedan ${Math.max(1, Math.round((a.fin - Date.now()) / 60_000))} min</span>
         </div>
         <p class="mt-1.5 font-semibold text-white">${esc(a.titulo)}${a.subtitulo ? ` <span class="font-normal text-slate-400">· ${esc(a.subtitulo)}</span>` : ''}</p>
         ${a.desc ? `<p class="mt-0.5 line-clamp-2 text-xs text-slate-400">${esc(a.desc)}</p>` : ''}
         <div class="mt-2 h-1 overflow-hidden rounded-full bg-sup-3"><div class="h-full rounded-full bg-cancha" style="width:${a.progreso.toFixed(1)}%"></div></div>`
      : '<p class="text-xs text-slate-500">Sin programa en emisión según la guía.</p>';
    const siguientes = p.siguientes.length
      ? `<p class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">A continuación</p>
         <ul class="mt-1 space-y-1 text-xs">${p.siguientes.map((s) => `
           <li class="flex gap-3"><span class="w-12 shrink-0 tabular-nums text-slate-500">${fmtHora.format(s.inicio)}</span><span class="truncate text-slate-300">${esc(s.titulo)}</span></li>`).join('')}
         </ul>`
      : '';
    dom.fichaEpg.innerHTML = actual + siguientes;
  }

  /** La guía cambió (fuentes, datos o el inicio): se actualiza lo que la muestra. */
  function alCambiarEpg(motivo) {
    const activas = epg.fuentes.filter((f) => f.estado === 'ok').length;
    dom.cuentaEpg.textContent = activas ? `(${activas})` : '';
    if (dom.dialogoEpg.open) pintarDialogoEpg();
    if (motivo === 'fuentes') return;
    // Datos nuevos: la búsqueda por programa y las líneas "▶ …" dependen de la guía.
    if (estado.tokens.length) aplicarFiltros();
    else refrescarEpgVisible();
    pintarFichaEpg();
    pintarAgenda(); // ¿qué partido va en qué canal? depende de la guía
  }

  function pintarDialogoEpg() {
    dom.inputProxy.value = epg.proxy;
    if (epg.activa) {
      const enlazados = estado.canales.length ? epg.contarEnlazados(estado.canales) : 0;
      dom.epgResumen.textContent = estado.canales.length
        ? `Guía activa: ${fmtNum.format(enlazados)} de ${fmtNum.format(estado.canales.length)} canales de la lista actual tienen programación.`
        : 'Guía activa. Carga una lista para ver qué canales tienen programación.';
    } else {
      dom.epgResumen.textContent = 'Sin guía cargada. Agrega la URL de un XMLTV o carga un archivo .xml / .xml.gz.';
    }

    dom.epgFuentes.innerHTML = epg.fuentes.map((f) => {
      const tipo = f.tipo === 'archivo' ? 'archivo' : f.tipo === 'lista' ? 'de la lista M3U' : 'URL';
      let detalle;
      if (f.estado === 'cargando') detalle = 'Cargando y analizando…';
      else if (f.estado === 'error') detalle = esc(f.mensaje || 'Error al cargar');
      else if (f.hora) {
        const horas = (Date.now() - f.hora) / 3600_000;
        detalle = `${fmtNum.format(f.canales || 0)} canales · ${fmtNum.format(f.programas || 0)} programas · actualizada ${horas < 1 ? `a las ${fmtHora.format(f.hora)}` : `hace ${Math.round(horas)} h`}`;
        if (f.tipo === 'archivo' && horas > 24) detalle += ' · vuelve a cargar el archivo para tener programación vigente';
      } else detalle = 'Pendiente';
      return `
        <li class="flex items-start gap-2 rounded-xl border border-linea bg-fondo p-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-white" title="${esc(f.valor)}">${esc(f.nombre)} <span class="insignia insignia-gris">${tipo}</span></p>
            <p class="mt-0.5 text-xs ${f.estado === 'error' ? 'text-vivo' : 'text-slate-500'}">${detalle}</p>
          </div>
          ${f.tipo !== 'archivo' ? `<button type="button" data-accion="recargar" data-id="${esc(f.id)}" class="control !px-2 !py-1 text-xs" title="Volver a descargar">↻</button>` : ''}
          <button type="button" data-accion="quitar" data-id="${esc(f.id)}" class="control !px-2 !py-1 text-xs" aria-label="Quitar ${esc(f.nombre)}" title="Quitar">✕</button>
        </li>`;
    }).join('');
  }

  function abrirGuia() {
    pintarDialogoEpg();
    dom.dialogoEpg.showModal();
  }

  async function agregarGuiaArchivo(archivo) {
    try {
      const f = await epg.agregarArchivo(archivo);
      toast(`Guía «${archivo.name}»: ${fmtNum.format(f.canales)} canales y ${fmtNum.format(f.programas)} programas.`, 'ok');
    } catch (err) {
      toast(`No se pudo leer la guía: ${err.message}`, 'error', 7000);
    }
  }

  function actualizarNavegacion() {
    const hay = estado.filtrados.length > 1 || (estado.filtrados.length === 1 && estado.filtrados[0].id !== estado.actual?.id);
    dom.btnAnterior.disabled = !hay;
    dom.btnSiguiente.disabled = !hay;
  }

  let tOsd = 0;
  /** Aviso grande sobre el video (también visible en pantalla completa). */
  function mostrarOsd(numero, texto) {
    dom.osdNumero.textContent = numero;
    dom.osdTexto.textContent = texto;
    dom.osd.classList.add('visible');
    clearTimeout(tOsd);
    tOsd = setTimeout(() => dom.osd.classList.remove('visible'), CONFIG.duracionOsd);
  }

  let tZapping = 0;
  dom.fichaAvisos.addEventListener('click', e => {
    if (!e.target.closest('[data-acceso-oficial]')) return;
    clearTimeout(tZapping);
    reproductor.detener();
  });
  /**
   * Selecciona y reproduce un canal.
   * @param {'clic'|'teclado'|'auto'} origen  Con 'teclado' la carga se retrasa un poco (zapping rápido).
   */
  window.detenerVideoHls = () => reproductor.detener();
  function ver(c, { origen = 'clic' } = {}) {
    if (!c) return;
    window.dispatchEvent(new CustomEvent('gambeta:cerrar-iframe'));
    reservarRedVideo();
    if (!esHlsInterno(c)) {
      siguienteSenal();
      return;
    }
    emergenciaSenal.hidden = true;
    document.querySelector('#chat-oferta-servidor').hidden = true;
    cancelarRespaldo();
    if (!['respaldo', 'servidor'].includes(origen)) {
      fallosCadena.clear();
      if (origen !== 'auto') pendienteCompartido = false;
    }
    catalogoServidores.set(c.url, c);
    cancelarTntExcepto(c.tntCanal || null);
    const listaFuente = LISTAS.find(l => l.url === (c.lista || estado.listaUrl));
    c.fuente = listaFuente ? `iptv-org-${listaFuente.id}` : 'personalizada';
    c.minimoConfirmacionMs = estadosCanales.minimoMs(c);
    const anterior = estado.actual;
    estado.actual = c;
    window.dispatchEvent(new CustomEvent('golstream:canal', { detail: { nombre: c.nombre } }));
    pintarSenales();
    estado.reproduciendo = false;
    pintarTnt();
    Memoria.guardar('ultimoCanal', c.url);

    refrescarTarjeta(anterior);
    refrescarTarjeta(c);
    actualizarFicha();
    actualizarNavegacion();

    clearTimeout(tZapping);
    if (origen === 'teclado') {
      const posicion = estado.filtrados.findIndex((x) => x.id === c.id);
      mostrarOsd(posicion >= 0 ? posicion + 1 : '', c.nombre);
      capa('cargando');
      dom.textoCargando.textContent = `Cambiando a ${c.nombre}…`;
      tZapping = setTimeout(() => reproductor.cargar(c), CONFIG.retardoZapping);
      // Mantiene visible en la lista el canal elegido (en PC; en celular no se mueve la página).
      if (!esMovil()) tarjetaEnPantalla(c)?.scrollIntoView({ block: 'nearest' });
    } else {
      reproductor.cargar(c);
      if (origen === 'clic' && esMovil()) dom.zonaReproductor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /** Canal anterior (-1) o siguiente (+1) dentro de la lista visible. Da la vuelta al llegar al final. */
  function zapping(paso, origen = 'teclado') {
    const lista = estado.filtrados;
    if (!lista.length) return;
    const i = lista.findIndex((c) => c.id === estado.actual?.id);
    const j = i === -1 ? (paso > 0 ? 0 : lista.length - 1) : (i + paso + lista.length) % lista.length;
    if (j === i) return; // un solo canal visible: no se recarga el mismo
    asegurarDibujado(j);
    ver(lista[j], { origen });
  }

  async function alternarPiP() {
    try {
      await reproductor.alternarPiP();
    } catch (err) {
      toast(err.codigo === 'sin-video'
        ? 'Primero reproduce un canal para abrir la ventana flotante.'
        : 'El navegador no permitió abrir la ventana flotante.', 'aviso');
    }
  }

  const alternarPantallaCompleta = () => reproductor.alternarPantallaCompleta(dom.contenedorVideo);

  /** Integra la app con los controles multimedia del sistema (teclas ⏮ ⏯ ⏭, pantalla de bloqueo). */
  function actualizarMediaSession(c) {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: c.nombre,
      artist: c.grupos.map(traducirGrupo).join(' · '),
      album: 'GolStream IPTV',
      artwork: c.logo ? [{ src: c.logo, sizes: '512x512' }] : [],
    });
  }

  if ('mediaSession' in navigator) {
    const acciones = {
      play: () => reproductor.alternarPausa(),
      pause: () => reproductor.alternarPausa(),
      previoustrack: () => zapping(-1),
      nexttrack: () => zapping(1),
    };
    for (const [accion, fn] of Object.entries(acciones)) {
      try { navigator.mediaSession.setActionHandler(accion, fn); } catch { /* acción no soportada */ }
    }
  }

  /* ---------------- 9. Agenda de fútbol chileno ----------------
     Partidos de hoy (js/agenda.js) y, para cada uno, si la guía de programación lo muestra en
     algún canal de las listas abiertas: botón para verlo ahí. Si no figura en la TV abierta,
     se indica quién tiene los derechos (sin enlaces). */

  const { estadoReal, coincidePrograma } = AgendaFutbol;
  const fmtDia = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
  const agendaUi = {
    plegada: Memoria.leer('agendaPlegada', false) === true,
    tv: new Map(),  // id de partido → [{ canal, programa }]
    claveTv: '',    // memo del cruce con la guía
  };

  /** Canales donde buscar el partido: lista activa primero y luego las demás abiertas o guardadas. */
  function canalesParaAgenda() {
    const vistos = new Set();
    const out = [];
    for (const lista of [estado.canales, ...fuentesGlobales().map((r) => r.canales)]) {
      for (const c of lista) {
        if (vistos.has(c.url)) continue;
        vistos.add(c.url);
        out.push(c);
      }
    }
    return out;
  }

  /** Cruza los partidos con la guía: ¿qué canal tiene en su programación «Local vs Visita»? */
  function calcularTransmisiones(eventos) {
    const clave = `${epg.version}|${agenda.version}|${estado.version}|${fuentesGlobales().length}`;
    if (clave === agendaUi.claveTv) return;
    agendaUi.claveTv = clave;
    agendaUi.tv = new Map();
    if (!epg.activa || !eventos.length) return;

    const canales = canalesParaAgenda().filter((c) => epg.enlazar(c));
    for (const ev of eventos) {
      const desde = ev.inicio - 30 * 60_000;
      const hasta = ev.inicio + AgendaFutbol.CFG.duracionMs;
      const porGuia = new Map(); // un canal de la guía puede estar en varias listas: se muestra una vez
      for (const c of canales) {
        const claveGuia = epg.enlazar(c);
        const previo = porGuia.get(claveGuia);
        // Entre copias del mismo canal se prefiere la que no está caída.
        if (previo && !(verificador.caido(previo.canal.url) && !verificador.caido(c.url))) continue;
        const programa = epg.programasEntre(c, desde, hasta)
          .find((p) => coincidePrograma(ev, normalizar(`${p.titulo} ${p.subtitulo || ''} ${p.desc || ''}`)));
        if (programa) porGuia.set(claveGuia, { canal: c, programa });
      }
      const lista = [...porGuia.values()].sort((a, b) => verificador.caido(a.canal.url) - verificador.caido(b.canal.url));
      if (lista.length) agendaUi.tv.set(ev.id, lista);
    }
  }

  function horaPartido(ev, t) {
    const hora = fmtHora.format(ev.inicio);
    const min = Math.round((ev.inicio - t) / 60_000);
    if (min > 0 && min < 180) return `${hora} · en ${min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`}`;
    return hora;
  }

  function etiquetaPartido(ev, est, t) {
    switch (est) {
      case 'vivo': return `<span class="insignia insignia-vivo"><span class="live-blink h-1.5 w-1.5 rounded-full bg-current"></span>En vivo${ev.detalle ? ` · ${esc(ev.detalle)}` : ''}</span>`;
      case 'comenzo': return `<span class="insignia insignia-vivo" title="La hora de inicio ya pasó; el marcador en vivo puede tardar unos minutos">Comenzó ${esc(fmtHora.format(ev.inicio))}</span>`;
      case 'por-empezar': return `<span class="insignia insignia-verde">${esc(horaPartido(ev, t))}</span>`;
      case 'final': return '<span class="insignia insignia-gris">Final</span>';
      case 'suspendido': return '<span class="insignia insignia-geo">Suspendido</span>';
      case 'sin-dato': return `<span class="insignia insignia-gris">${esc(fmtHora.format(ev.inicio))} · sin resultado</span>`;
      default: return `<span class="text-xs tabular-nums text-slate-300">${esc(horaPartido(ev, t))}</span>`;
    }
  }

  function filaEquipo(nombre, escudo, goles, mostrarGoles, ganador) {
    return `<div class="flex items-center gap-2">
        <span class="grid h-5 w-5 shrink-0 place-items-center">${escudo ? `<img data-logo src="${esc(escudo)}/tiny" alt="" class="h-5 w-5 object-contain" loading="lazy" referrerpolicy="no-referrer" />` : ''}</span>
        <span class="min-w-0 flex-1 truncate text-sm ${ganador ? 'font-semibold text-white' : 'text-slate-200'}">${esc(nombre)}</span>
        ${mostrarGoles ? `<span class="font-display text-lg font-bold tabular-nums ${ganador ? 'text-white' : 'text-slate-300'}">${esc(goles)}</span>` : ''}
      </div>`;
  }

  /** Dónde verlo: canales de la guía (botón) o, si no figura en TV abierta, quién tiene los derechos. */
  function lineaTv(ev, { compacta = false } = {}) {
    const tv = agendaUi.tv.get(ev.id) || [];
    if (tv.length) {
      const botones = tv.slice(0, compacta ? 1 : 2).map(({ canal, programa }, i) =>
        `<button type="button" class="boton-tv${verificador.caido(canal.url) ? ' caido' : ''}" data-accion="ver-partido" data-evento="${esc(ev.id)}" data-indice="${i}"
          title="${esc(`${canal.nombre} · «${programa.titulo}» ${fmtHora.format(programa.inicio)}–${fmtHora.format(programa.fin)}`)}">📺 ${esc(canal.nombre)}</button>`).join('');
      const mas = tv.length > (compacta ? 1 : 2) ? `<span class="text-slate-500">+${tv.length - (compacta ? 1 : 2)}</span>` : '';
      return `<div class="flex min-w-0 flex-wrap items-center gap-1">${botones}${mas}</div>`;
    }
    if (!epg.activa) return '<span class="text-slate-500" title="Carga la guía de Chile en «Guía» para detectar la TV abierta">TV abierta: sin guía cargada</span>';
    if (ev.pago) return `<span class="text-slate-400" title="No figura en la guía de los canales de tus listas">🔒 ${esc(ev.pago)} · suscripción</span>`;
    return '<span class="text-slate-500">No figura en la guía de tus canales</span>';
  }

  function tarjetaPartido(ev, t) {
    const est = estadoReal(ev, t);
    const goles = ev.golesLocal != null && ev.golesVisita != null && ['vivo', 'final', 'comenzo', 'sin-dato'].includes(est);
    const ganaLocal = goles && est === 'final' && ev.golesLocal > ev.golesVisita;
    const ganaVisita = goles && est === 'final' && ev.golesVisita > ev.golesLocal;
    const enJuego = est === 'vivo' || est === 'comenzo';
    return `<li class="partido${enJuego ? ' en-juego' : ''}${est === 'final' ? ' terminado' : ''}">
        <div class="flex items-center justify-between gap-2 text-[11px]">
          <span class="truncate font-semibold uppercase tracking-wide ${ev.roja ? 'text-vivo' : 'text-slate-400'}" title="${esc(ev.torneo)}">${ev.roja ? '🇨🇱 ' : ''}${esc(ev.roja ? ev.torneo : ev.comp)}</span>
          ${etiquetaPartido(ev, est, t)}
        </div>
        <div class="mt-2 space-y-1.5">
          ${filaEquipo(ev.local, ev.escudoLocal, ev.golesLocal, goles, ganaLocal)}
          ${filaEquipo(ev.visita, ev.escudoVisita, ev.golesVisita, goles, ganaVisita)}
        </div>
        <div class="mt-2.5 border-t border-linea pt-2 text-[11px]">${lineaTv(ev)}</div>
      </li>`;
  }

  function filaProximo(ev) {
    return `<li class="flex items-center gap-2 rounded-lg bg-fondo px-2.5 py-1.5">
        <span class="w-24 shrink-0 tabular-nums text-slate-500">${esc(fmtDia.format(ev.inicio))} ${esc(fmtHora.format(ev.inicio))}</span>
        <span class="min-w-0 flex-1 truncate text-slate-200" title="${esc(`${ev.torneo} · ${ev.estadio}`)}"><span class="${ev.roja ? 'text-vivo' : 'text-slate-500'}">${esc(ev.roja ? 'La Roja' : ev.comp)}</span> · ${esc(ev.local)} vs ${esc(ev.visita)}</span>
        <span class="shrink-0">${agendaUi.tv.has(ev.id) ? lineaTv(ev, { compacta: true }) : ''}</span>
      </li>`;
  }

  function pintarAgenda() {
    const t = Date.now();
    const hoy = agenda.hoy(t);
    const proximos = agenda.proximos(t);
    calcularTransmisiones([...hoy, ...proximos]);

    dom.btnAgendaPlegar.setAttribute('aria-expanded', String(!agendaUi.plegada));
    dom.agendaCuerpo.hidden = agendaUi.plegada;
    dom.btnAgendaActualizar.disabled = agenda.actualizando;
    dom.btnAgendaActualizar.classList.toggle('girando', agenda.actualizando);

    const enJuego = hoy.filter((e) => ['vivo', 'comenzo'].includes(estadoReal(e, t))).length;
    const enTv = hoy.filter((e) => agendaUi.tv.has(e.id)).length;
    dom.agendaResumen.textContent = agenda.estado === 'cargando' ? 'consultando…'
      : !hoy.length ? 'sin partidos hoy'
      : [`${hoy.length} ${hoy.length === 1 ? 'partido' : 'partidos'}`, enJuego ? `🔴 ${enJuego} en juego` : '', enTv ? `📺 ${enTv} en tus canales` : '']
        .filter(Boolean).join(' · ');

    if (agenda.estado === 'cargando' && !hoy.length) {
      dom.agendaHoy.innerHTML = '<li class="flex items-center gap-2 px-1 py-3 text-xs text-slate-400"><span class="spinner spinner-sm" aria-hidden="true"></span>Consultando los partidos de hoy…</li>';
    } else if (agenda.estado === 'error' && !hoy.length) {
      dom.agendaHoy.innerHTML = `<li class="vacio w-full !p-3 !text-xs">${esc(agenda.mensaje)}</li>`;
    } else if (!hoy.length) {
      const sig = proximos[0];
      dom.agendaHoy.innerHTML = `<li class="vacio w-full !p-3 !text-xs">Hoy no juega ningún equipo del fútbol chileno${sig ? ` · próximo: <b class="text-slate-300">${esc(sig.local)} vs ${esc(sig.visita)}</b>, ${esc(fmtDia.format(sig.inicio))} a las ${esc(fmtHora.format(sig.inicio))}` : ''}.</li>`;
    } else {
      dom.agendaHoy.innerHTML = hoy.map((e) => tarjetaPartido(e, t)).join('');
    }

    dom.agendaProximosCaja.hidden = !proximos.length;
    dom.agendaCuentaProximos.textContent = `(${proximos.length})`;
    dom.agendaProximos.innerHTML = proximos.map(filaProximo).join('');

    const notas = [
      `Calendario: TheSportsDB${agenda.hora ? ` · actualizado ${fmtHora.format(agenda.hora)}` : ''} · horas de tu zona`,
      epg.activa
        ? '📺 = el partido figura en la guía de ese canal (de tus listas)'
        : 'Para saber qué partidos van por TV abierta, carga la guía de Chile en «Guía»',
      agenda.mensaje,
    ];
    dom.agendaNota.textContent = notas.filter(Boolean).join(' · ');
  }

  /* ---------------- 10. Control remoto por teclado ---------------- */

  /** ¿El foco está en un lugar donde el usuario escribe? Ahí no se interceptan teclas. */
  function estaEscribiendo(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  let digitos = '';
  let tDigitos = 0;
  /** Teclear un número (ej. 1, 2) salta al canal 12 de la lista visible, como en un control remoto. */
  function teclearDigito(d) {
    if (!estado.filtrados.length) return;
    digitos = (digitos + d).slice(-4);
    mostrarOsd(`${digitos}_`, 'Ir al canal…');
    clearTimeout(tDigitos);
    tDigitos = setTimeout(() => {
      const n = parseInt(digitos, 10);
      digitos = '';
      const c = estado.filtrados[n - 1];
      if (c) {
        asegurarDibujado(n - 1);
        ver(c, { origen: 'teclado' });
      } else {
        mostrarOsd(String(n), `No existe (hay ${estado.filtrados.length})`);
      }
    }, CONFIG.esperaDigitos);
  }

  function alPresionarTecla(e) {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return; // respeta Ctrl+F, Alt+Tab, etc.
    const el = document.activeElement;

    // Las categorías conservan sus teclas de navegación y activación nativas.
    if (el?.closest('#pestanas-listas') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(e.key)) return;

    if (estaEscribiendo(el)) {
      // Esc o ↓ en el buscador devuelven el control remoto a la lista.
      if (el === dom.buscador && (e.key === 'Escape' || e.key === 'ArrowDown')) {
        e.preventDefault();
        dom.buscador.blur();
      }
      return;
    }
    const dlgAdmin = document.getElementById('dialogo-admin');
    if (document.body.classList.contains('bloqueado-acceso') || dom.dialogoAtajos.open || dom.dialogoEpg.open || dlgAdmin?.open) return; // los diálogos manejan sus teclas (Esc los cierra)

    const accion = {
      ArrowDown: () => zapping(1),
      ArrowUp: () => zapping(-1),
      ' ': () => {
        if (!estado.actual) return zapping(1); // sin canal: Espacio arranca el primero
        const r = reproductor.alternarPausa();
        if (r !== null) mostrarOsd(r ? '▶' : '❚❚', r ? 'Reproduciendo' : 'En pausa');
      },
      f: alternarPantallaCompleta,
      p: alternarPiP,
      m: () => {
        const mudo = reproductor.alternarSilencio();
        mostrarOsd(mudo ? '🔇' : '🔊', mudo ? 'Silenciado' : 'Sonido activado');
      },
      s: () => alternarFavorito(estado.actual),
      g: abrirGuia,
      '/': () => dom.buscador.focus(),
      '?': () => dom.dialogoAtajos.showModal(),
    }[e.key.length === 1 ? e.key.toLowerCase() : e.key];

    if (accion) {
      // Evita que la página haga scroll con flechas/espacio o que un botón enfocado se "pulse" con Espacio.
      e.preventDefault();
      accion();
    } else if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      teclearDigito(e.key);
    }
  }

  // Fase de captura: se atiende antes que los controles nativos del <video> (evita dobles pausas).
  document.addEventListener('keydown', alPresionarTecla, true);

  /* ---------------- 11. Eventos de la interfaz e inicio ---------------- */

  // "Cargar lista" siempre descarga de nuevo (ignora la caché) por si la lista cambió.
  dom.formLista.addEventListener('submit', (e) => {
    e.preventDefault();
    cargar(dom.inputLista.value, { forzar: true });
  });

  // Pestañas de listas oficiales: usan la caché, así volver a una lista es instantáneo.
  dom.pestanas.addEventListener('click', (e) => {
    const b = e.target.closest('[data-url]');
    if (!b || b.disabled || b.dataset.url === estado.listaUrl) return;
    dom.inputLista.value = b.dataset.url;
    cargar(b.dataset.url);
  });
  dom.pestanas.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const botones = [...dom.pestanas.querySelectorAll('[role="tab"]:not(:disabled)')];
    const actual = botones.indexOf(e.target.closest('[role="tab"]'));
    if (actual < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const siguiente = e.key === 'Home' ? 0 : e.key === 'End' ? botones.length - 1
      : (actual + (e.key === 'ArrowRight' ? 1 : -1) + botones.length) % botones.length;
    botones.forEach((b, i) => { b.tabIndex = i === siguiente ? 0 : -1; });
    botones[siguiente].focus();
  });
  dom.btnDefecto.addEventListener('click', () => {
    dom.inputLista.value = CONFIG.listaPorDefecto;
    cargar(CONFIG.listaPorDefecto);
  });
  dom.selPreset.addEventListener('change', () => {
    const url = dom.selPreset.value;
    dom.selPreset.value = '';
    if (url) {
      dom.inputLista.value = url;
      cargar(url);
    }
  });
  dom.atajos.addEventListener('click', (e) => {
    const b = e.target.closest('[data-url]');
    if (b) {
      dom.inputLista.value = b.dataset.url;
      cargar(b.dataset.url);
    }
  });
  dom.btnCancelar.addEventListener('click', () => estado.carga?.abort());
  dom.btnReintentarLista.addEventListener('click', () => estado.ultimaUrl && cargar(estado.ultimaUrl));

  // Buscador en tiempo real: agrupa las teclas que llegan casi juntas (16 ms ≈ un cuadro)
  // y filtra de forma incremental sobre los resultados anteriores.
  let pendienteBusqueda = 0;
  dom.buscador.addEventListener('input', () => {
    clearTimeout(pendienteBusqueda);
    pendienteBusqueda = setTimeout(() => {
      estado.consulta = dom.buscador.value;
      estado.tokens = normalizar(estado.consulta).split(' ').filter(Boolean);
      aplicarFiltros({ incremental: true });
    }, 16);
  });

  dom.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filtro]');
    if (!chip) return;
    estado.filtro = chip.dataset.filtro;
    dom.chips.querySelectorAll('[data-filtro]').forEach((c) => {
      c.setAttribute('aria-pressed', String(c === chip));
      c.setAttribute('aria-selected', String(c === chip));
    });
    aplicarFiltros();
    actualizarFicha(); // la posición "Canal X de Y" depende de la vista
  });
  dom.selGrupo.addEventListener('change', () => {
    estado.grupo = dom.selGrupo.value;
    aplicarFiltros();
  });
  dom.chkGeo.checked = estado.ocultarGeo;
  dom.chkGeo.addEventListener('change', () => {
    estado.ocultarGeo = dom.chkGeo.checked;
    Memoria.guardar('ocultarGeo', estado.ocultarGeo);
    aplicarFiltros();
  });
  dom.chkMuertos.checked = estado.ocultarMuertos;
  dom.chkMuertos.addEventListener('change', () => {
    estado.ocultarMuertos = dom.chkMuertos.checked;
    Memoria.guardar('ocultarMuertos', estado.ocultarMuertos);
    aplicarFiltros();
  });
  dom.chkGlobal.checked = estado.buscarGlobal;
  dom.chkGlobal.addEventListener('change', () => {
    estado.buscarGlobal = dom.chkGlobal.checked;
    Memoria.guardar('buscarGlobal', estado.buscarGlobal);
    aplicarFiltros();
  });
  dom.btnVerificar.addEventListener('click', verificarVista);

  // Un solo listener por lista (delegación de eventos): lista activa y resultados globales.
  function alClicCanal(e, fuente) {
    const boton = e.target.closest('[data-accion]');
    const li = boton?.closest('[data-id]');
    const canal = li && fuente().find((c) => c.id === li.dataset.id);
    if (!canal) return;
    if (boton.dataset.accion === 'fav') alternarFavorito(canal);
    else ver(canal);
  }
  dom.lista.addEventListener('click', (e) => alClicCanal(e, () => estado.filtrados));
  dom.listaGlobal.addEventListener('click', (e) => alClicCanal(e, () => estado.globales.lista));

  // Mis listas.
  dom.btnGuardarLista.addEventListener('click', alternarGuardarLista);
  dom.misListas.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    if (b.dataset.accion === 'quitar') return quitarMiLista(b.dataset.url);
    if (b.dataset.url !== estado.listaUrl) {
      dom.inputLista.value = b.dataset.url;
      cargar(b.dataset.url);
    }
  });

  // Guía de programación (EPG).
  dom.btnEpg.addEventListener('click', abrirGuia);
  dom.btnCerrarEpg.addEventListener('click', () => dom.dialogoEpg.close());
  dom.dialogoEpg.addEventListener('click', (e) => { if (e.target === dom.dialogoEpg) dom.dialogoEpg.close(); });
  dom.formEpg.addEventListener('submit', async (e) => {
    e.preventDefault();
    let url;
    try {
      url = prepararUrlLista(dom.inputEpg.value).href;
    } catch (err) {
      return toast(err.message, 'error');
    }
    dom.inputEpg.value = '';
    try {
      const f = await epg.agregarUrl(url);
      toast(`Guía agregada: ${fmtNum.format(f.canales)} canales y ${fmtNum.format(f.programas)} programas.`, 'ok');
    } catch {
      /* el motivo queda visible en la fuente, dentro del diálogo */
    }
  });
  dom.inputEpgArchivo.addEventListener('change', () => {
    const archivo = dom.inputEpgArchivo.files[0];
    if (archivo) agregarGuiaArchivo(archivo);
    dom.inputEpgArchivo.value = '';
  });
  ['dragenter', 'dragover'].forEach((tipo) => dom.zonaEpgArchivo.addEventListener(tipo, (e) => {
    e.preventDefault();
    dom.zonaEpgArchivo.classList.add('border-cancha');
  }));
  ['dragleave', 'drop'].forEach((tipo) => dom.zonaEpgArchivo.addEventListener(tipo, () => dom.zonaEpgArchivo.classList.remove('border-cancha')));
  dom.zonaEpgArchivo.addEventListener('drop', (e) => {
    e.preventDefault();
    const archivo = e.dataTransfer.files[0];
    if (archivo) agregarGuiaArchivo(archivo);
  });
  dom.epgFuentes.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accion]');
    if (!b) return;
    if (b.dataset.accion === 'quitar') epg.quitar(b.dataset.id);
    else epg.recargar(b.dataset.id).catch(() => {});
  });
  dom.btnGuardarProxy.addEventListener('click', () => {
    const valor = dom.inputProxy.value.trim();
    if (valor) {
      try { validarUrl(valor.replace('{url}', 'x')); } catch (err) { return toast(`Proxy no válido: ${err.message}`, 'error'); }
    }
    epg.guardarProxy(valor);
    toast(valor ? 'Proxy CORS guardado. Usa ↻ en una fuente para volver a intentar.' : 'Proxy CORS desactivado.', 'ok');
  });

  // Agenda de fútbol chileno.
  dom.btnAgendaPlegar.addEventListener('click', () => {
    agendaUi.plegada = !agendaUi.plegada;
    Memoria.guardar('agendaPlegada', agendaUi.plegada || null);
    pintarAgenda();
  });
  dom.btnAgendaActualizar.addEventListener('click', () => agenda.actualizar({ completa: true }).catch(() => {}));
  dom.agenda.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accion="ver-partido"]');
    const opcion = b && agendaUi.tv.get(b.dataset.evento)?.[Number(b.dataset.indice)];
    if (!opcion) return;
    const ev = agenda.hoy().concat(agenda.proximos()).find((x) => x.id === b.dataset.evento);
    Analitica.evento('ver_partido', { partido: ev ? `${ev.local} vs ${ev.visita}` : '', canal: opcion.canal.nombre });
    ver(opcion.canal);
  });

  // La guía y la agenda avanzan con la hora: se actualiza cada minuto lo que se ve en pantalla.
  setInterval(() => {
    pintarAgenda(); // cuentas regresivas y "Comenzó"
    if (!epg.activa) return;
    refrescarEpgVisible();
    pintarFichaEpg();
  }, 60_000);

  // Logo roto → se quita la imagen y quedan las iniciales.
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-logo')) e.target.remove();
  }, true);

  dom.btnAnterior.addEventListener('click', () => zapping(-1, 'clic'));
  dom.btnSiguiente.addEventListener('click', () => zapping(1, 'clic'));
  dom.btnSiguienteError.addEventListener('click', () => zapping(1, 'clic'));
  dom.btnReintentar.addEventListener('click', () => {
    const gestor = gestorTntActivo();
    if (estado.actual?.tntFuente && gestor) gestor.iniciar(gestor.agotadas ? 0 : Math.max(0, gestor.fuentes.findIndex(f => f.id === estado.actual.tntFuente)));
    else reproductor.reintentar();
  });
  dom.selCalidad.addEventListener('change', () => reproductor.setCalidad(dom.selCalidad.value));
  dom.btnFavFicha.addEventListener('click', () => alternarFavorito(estado.actual));
  /** Copia la URL del stream para abrirla en VLC (Medio → Abrir ubicación de red) u otro reproductor. */
  async function copiarUrl() {
    if (!estado.actual) return;
    try {
      await navigator.clipboard.writeText(accesoOficial(estado.actual) || estado.actual.url);
      toast('URL copiada. En VLC: Medio → Abrir ubicación de red → pegar (Ctrl+V).', 'ok', 5000);
    } catch {
      toast('No se pudo copiar automáticamente; selecciona la URL bajo el título del canal.', 'aviso');
    }
  }
  dom.btnCopiar.addEventListener('click', copiarUrl);
  dom.btnCopiarError.addEventListener('click', copiarUrl);

  // Botones flotantes del reproductor.
  dom.btnPip.hidden = !reproductor.soportaPiP;
  dom.btnPip.addEventListener('click', alternarPiP);
  const syncPiP = () => dom.btnPip.setAttribute('aria-pressed', String(reproductor.enPiP));
  dom.video.addEventListener('enterpictureinpicture', syncPiP);
  dom.video.addEventListener('leavepictureinpicture', syncPiP);
  dom.video.addEventListener('webkitpresentationmodechanged', syncPiP);

  dom.btnPantalla.addEventListener('click', alternarPantallaCompleta);
  const syncPantalla = () => dom.btnPantalla.setAttribute('aria-pressed', String(reproductor.enPantallaCompleta));
  document.addEventListener('fullscreenchange', syncPantalla);
  document.addEventListener('webkitfullscreenchange', syncPantalla);
  // Doble clic sobre el video: misma pantalla completa que la tecla F (con insignias y OSD).
  dom.video.addEventListener('dblclick', (e) => {
    e.preventDefault();
    alternarPantallaCompleta();
  });

  // Memoria: volumen preferido.
  const volumen = Number(Memoria.leer('volumen'));
  if (volumen >= 0 && volumen <= 1 && Memoria.leer('volumen') !== null) dom.video.volume = volumen;
  dom.video.addEventListener('volumechange', () => Memoria.guardar('volumen', Math.round(dom.video.volume * 100) / 100));
  const activarSonido = document.querySelector('#activar-sonido');
  const actualizarSonido = () => { activarSonido.hidden = !dom.video.muted && dom.video.volume > 0; };
  dom.video.addEventListener('volumechange', actualizarSonido);
  activarSonido.addEventListener('click', () => {
    dom.video.muted = false;
    dom.video.volume = 1.0;
    actualizarSonido();
    // El gesto también reanuda Safari si pausó el video al cambiar el audio.
    dom.video.play()?.catch(() => { dom.video.controls = true; });
  });

  // Ayuda de atajos.
  dom.btnAtajos.addEventListener('click', () => dom.dialogoAtajos.showModal());
  dom.btnCerrarAtajos.addEventListener('click', () => dom.dialogoAtajos.close());
  dom.dialogoAtajos.addEventListener('click', (e) => { if (e.target === dom.dialogoAtajos) dom.dialogoAtajos.close(); });
  dom.dialogoAtajos.addEventListener('keydown', (e) => {
    if (e.key === '?') { e.preventDefault(); dom.dialogoAtajos.close(); }
  });

  if (location.protocol === 'file:') {
    toast('Abre la app con Live Server: con doble clic (file://) algunas funciones del navegador quedan bloqueadas.', 'aviso', 9000);
  }

  // Consejo único para quien usa teclado y mouse (no se muestra en celulares).
  if (window.matchMedia('(pointer: fine)').matches && !Memoria.leer('vioConsejoTeclado')) {
    setTimeout(() => toast('Consejo: usa ↑ ↓ para cambiar de canal, Espacio para pausar y F para pantalla completa. Pulsa ? para ver todos los atajos.', 'info', 8000), 1500);
    Memoria.guardar('vioConsejoTeclado', true);
  }

  Memoria.guardar('fuente', null); // limpia una clave de la primera versión de la app

  // Autoplay inmediato con catálogo local; nunca verifica en paralelo al video.
  const desdeDireccion = new URLSearchParams(location.search).get('lista');
  const inicial = desdeDireccion || CONFIG.listaPorDefecto;
  configurarSenales([]);
  actualizarModoChile();
  setInterval(actualizarModoChile, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizarModoChile(); });
  capa('reposo');
  pintarFuentes();
  marcarPestana(null);
  pintarMisListas();
  actualizarEstadoGlobal();
  actualizarBotonGuardar();
  aplicarFiltros(); // muestra favoritos/contadores aunque aún no haya lista
  dom.video.muted = true;
  dom.video.playsInline = true;
  actualizarSonido();
  const senalInicial = candidatosPartido[0].find(c => c.url === CANALES_PARTIDO_HOY[0].url);
  senalesPartido[0] = senalInicial;
  ver(senalInicial, { origen: 'auto' });
  // Las guías remotas se cargan a petición; no compiten con el arranque del video.
  pintarAgenda(); // lo guardado en el dispositivo se ve al instante
  alVerSeccion('#agenda', () => agenda.iniciar()); // TheSportsDB solo cuando la agenda está en pantalla
  if (typeof inicial === 'string' && inicial) {
    dom.inputLista.value = inicial;
    cargar(inicial);
  }
})();

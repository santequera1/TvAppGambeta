/* =============================================================
   GolStream IPTV · parser.js
   Red (fetch) + motor de parsing de listas M3U, optimizado para
   listas de miles de canales.

   - El análisis corre en un Web Worker (js/parser.worker.js):
     la interfaz nunca se congela, aunque la lista tenga 11.000+ canales.
   - Sin Worker (p. ej. abriendo con doble clic, file://) analiza por
     partes y cede el control al navegador entre tandas.
   - Rutas rápidas: cada URL se valida una sola vez y el texto ASCII
     no pasa por la normalización Unicode (lo más costoso).

   API pública → ParserM3U (en window, y en self dentro del Worker)
     prepararUrlLista(texto)        Valida la URL pegada (corrige enlaces de GitHub)
     validarUrl(texto, base?)       URL http(s) segura o ErrorLista
     descargarLista(url, opciones)  Descarga con timeout, límite de tamaño y progreso
     parsear(texto, urlBase)        Análisis síncrono (lo usa el Worker)
     parsearEnSegundoPlano(...)     Worker → o por partes si no hay Worker
     cargarLista(texto, opciones)   Todo junto: validar → descargar → analizar
     parsearXMLTV(texto, ventana)   Guía de programación XMLTV → canales y programas
     procesarGuiaEnSegundoPlano()   Guía .xml / .xml.gz analizada en el Worker
     cargarGuia(url, opciones)      Descarga (con proxy CORS opcional) + análisis de una guía
     normalizar(texto)              Texto sin tildes ni símbolos (buscador)
     traducirGrupo(nombre)          "Sports" → "Deportes"
     clasificar(canal)              Categorías inteligentes: deportes/noticias/peliculas/entretenimiento
     ErrorLista                     Error con .codigo legible por la interfaz
   ============================================================= */
(function (global) {
  'use strict';

  const LIMITES = {
    timeoutMs: 30_000,            // tiempo máximo de descarga de la lista
    maxBytes: 40 * 1024 * 1024,   // 40 MB: protege el navegador de archivos gigantes
    maxLargoUrl: 2048,
    lineasPorTanda: 4000,         // cada cuántas líneas avisa de su progreso el Worker
    msPorTanda: 12,               // análisis por partes: trabajo máximo antes de ceder el hilo
  };

  // URL de este script (solo existe en la página): sirve para ubicar el Worker con ruta relativa.
  const URL_SCRIPT = global.document?.currentScript?.src || null;

  /** Error con código para que la interfaz muestre un mensaje adecuado. */
  class ErrorLista extends Error {
    /** @param {'url'|'red'|'timeout'|'http'|'tamano'|'formato'|'vacia'|'cancelado'} codigo */
    constructor(codigo, mensaje, detalle) {
      super(mensaje);
      this.name = 'ErrorLista';
      this.codigo = codigo;
      this.detalle = detalle;
    }
  }

  /* ---------------- Utilidades de texto ---------------- */

  const RE_SOLO_ASCII = /^[\x00-\x7F]*$/;

  /** "Fútbol-TV (HD)" → "futbol tv hd". El texto ASCII se salta la normalización Unicode. */
  function normalizar(s) {
    let t = String(s ?? '');
    if (!RE_SOLO_ASCII.test(t)) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** Las categorías de iptv-org vienen en inglés: se muestran en español. */
  const GRUPOS_ES = {
    animation: 'Animación', auto: 'Motor', business: 'Negocios', classic: 'Clásicos',
    comedy: 'Comedia', cooking: 'Cocina', culture: 'Cultura', documentary: 'Documentales',
    education: 'Educación', entertainment: 'Entretenimiento', family: 'Familia', general: 'General',
    kids: 'Infantil', legislative: 'Legislativo', lifestyle: 'Estilo de vida', movies: 'Películas',
    music: 'Música', news: 'Noticias', outdoor: 'Aire libre', public: 'Pública', relax: 'Relax',
    religious: 'Religión', science: 'Ciencia', series: 'Series', shop: 'Compras', sports: 'Deportes',
    travel: 'Viajes', undefined: 'Sin categoría', weather: 'Clima',
  };
  const traducirGrupo = (g) => GRUPOS_ES[String(g).toLowerCase()] ?? g;

  /**
   * Filtro inteligente: un canal entra en una categoría si su group-title coincide
   * o si su nombre contiene palabras clave (útil en listas con categoría "Undefined").
   * Se calcula aquí, dentro del Worker, para no cargar la interfaz con miles de canales.
   */
  const CATEGORIAS = {
    deportes: {
      grupos: ['sports'],
      re: /\b(sport\w*|deporte\w*|deportiv\w*|esporte\w*|futbol\w*|futebol|calcio|soccer|football|espn\w*|tyc|tudn|dsports|bein|eurosport\w*|dazn|gol|goltv|golf|tenis|tennis|nba|nfl|mlb|nhl|ufc|wwe|f1|motogp|laliga|premier|serie a|liga)\b/,
    },
    noticias: {
      grupos: ['news', 'weather', 'business'],
      re: /\b(news|noticia\w*|noticiero\w*|informativo\w*|24 horas|24h|cnn\w*|telesur|euronews|dw|france 24|rt|tg24|rainews\w*|globonews|al jazeera|cnbc|bloomberg|c5n|tn|a24|cronica|meganoticias|t13)\b/,
    },
    peliculas: {
      grupos: ['movies', 'series', 'classic'],
      re: /\b(cine\w*|cinema\w*|movie\w*|film\w*|pelicula\w*|series?|novela\w*)\b/,
    },
    entretenimiento: {
      grupos: ['entertainment', 'comedy', 'lifestyle', 'family', 'music', 'cooking', 'travel', 'relax', 'animation', 'kids', 'culture', 'outdoor', 'shop'],
      re: /\b(entretenimiento|entertainment|comedy|comedia|music\w*|musica|reality|show)\b/,
    },
  };
  const NOMBRES_CATEGORIA = Object.keys(CATEGORIAS);

  /** Categorías inteligentes de un canal ({ grupos, busqueda }), p. ej. ['deportes', 'noticias']. */
  function clasificar({ grupos, busqueda }) {
    const g = grupos.map((x) => x.toLowerCase());
    return NOMBRES_CATEGORIA.filter((k) => g.some((x) => CATEGORIAS[k].grupos.includes(x)) || CATEGORIAS[k].re.test(busqueda));
  }

  /**
   * Sinónimos de búsqueda para canales conocidos por otro nombre.
   * Clave: la parte del tvg-id antes del punto, en minúsculas ("Mega.cl@SD" → "mega").
   * No crea canales: solo permite encontrar los que ya trae la lista
   * (p. ej. buscar "Megavisión" encuentra "Mega (Chile)").
   */
  const SINONIMOS = {
    mega: 'megavision mega tv',
    meganoticiasahora: 'meganoticias',
    chilevision: 'chilevision chv',
    canal13: 'canal 13 trece',
    t13envivo: 't13 tele13 teletrece canal 13 noticias',
    tvn: 'television nacional tvn chile',
    tvn3: 'television nacional',
    '24horas': '24h 24 horas tvn noticias',
    tvplus: 'tv mas tvmas ucv',
    lared: 'la red',
    cnnchile: 'cnn',
  };

  /** Hash corto y estable (djb2) para ids. */
  function hash(texto) {
    let h = 5381;
    for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ---------------- Validación de URLs ---------------- */

  const RE_CONTROL = /[\u0000-\u001F\u007F]/;
  // Ruta rápida: URL absoluta http(s) sin espacios ni caracteres problemáticos.
  const RE_URL_SIMPLE = /^https?:\/\/[^\s"'<>\\^`{|}]+$/i;

  /**
   * Valida y normaliza una URL. Solo se permiten http:// y https://
   * (bloquea javascript:, data:, file:, etc.). Lanza ErrorLista si no es válida.
   * @returns {URL}
   */
  function validarUrl(texto, base) {
    const limpio = String(texto ?? '').trim();
    if (!limpio) throw new ErrorLista('url', 'Escribe o pega la URL de una lista M3U.');
    if (limpio.length > LIMITES.maxLargoUrl) throw new ErrorLista('url', 'La URL es demasiado larga.');
    if (RE_CONTROL.test(limpio)) throw new ErrorLista('url', 'La URL contiene caracteres no válidos.');

    let url;
    try {
      url = new URL(limpio, base);
    } catch {
      throw new ErrorLista('url', 'La URL no tiene un formato válido.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ErrorLista('url', `Protocolo no permitido (${url.protocol}). Solo se aceptan enlaces http:// o https://.`);
    }
    if (url.username || url.password) {
      throw new ErrorLista('url', 'Por seguridad no se aceptan URLs con usuario y contraseña incrustados (usuario:clave@...).');
    }
    return url;
  }

  /**
   * Versión rápida y sin excepciones para cada stream/logo de la lista.
   * Las URLs absolutas "normales" (casi todas) se aceptan con una regex;
   * el resto (relativas, con @, raras) pasa por la validación completa.
   * @returns {string|null}
   */
  function urlSegura(texto, base) {
    const t = String(texto ?? '').trim();
    if (!t || t.length > LIMITES.maxLargoUrl) return null;
    if (RE_URL_SIMPLE.test(t)) {
      const inicioHost = t.indexOf('//') + 2;
      const finHost = t.slice(inicioHost).search(/[/?#]/);
      const autoridad = finHost === -1 ? t.slice(inicioHost) : t.slice(inicioHost, inicioHost + finHost);
      if (!autoridad.includes('@') && autoridad.length > 0) return t; // sin usuario:clave@
    }
    try {
      return validarUrl(t, base).href;
    } catch {
      return null;
    }
  }

  /**
   * Prepara la URL que pega el usuario:
   *  - agrega https:// si falta ("iptv-org.github.io/iptv/index.m3u")
   *  - convierte github.com/.../blob/... al enlace "raw" (el blob es una página HTML)
   */
  function prepararUrlLista(texto) {
    let t = String(texto ?? '').trim();
    // Sin esquema ("dominio.com/lista.m3u" o "localhost:5500/…") → https://.
    // Con otro esquema ("javascript:", "file:") se deja tal cual para que validarUrl lo rechace.
    if (t && !/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) t = `https://${t}`;
    const url = validarUrl(t);

    if (url.hostname === 'github.com') {
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
      if (m) return new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
      throw new ErrorLista('url', 'Eso es una página de GitHub, no una lista. Abre el archivo .m3u en GitHub y copia el enlace del botón "Raw".');
    }
    return url;
  }

  /* ---------------- Red ---------------- */

  /**
   * Descarga el texto de la lista.
   * @param {URL} url
   * @param {{ signal?: AbortSignal, onProgreso?: (bytes:number, total:number) => void }} opciones
   * @returns {Promise<{ texto: string, urlFinal: string, bytes: number }>}
   */
  async function descargarLista(url, opciones = {}) {
    const { partes, urlFinal, bytes } = await descargar(url, opciones);
    const texto = await new Blob(partes).text(); // decodifica UTF-8
    return { texto, urlFinal, bytes };
  }

  /** Igual que descargarLista pero devuelve los bytes (para guías XMLTV comprimidas .gz). */
  async function descargarBinario(url, opciones = {}) {
    const { partes, urlFinal, bytes } = await descargar(url, opciones);
    return { buffer: await new Blob(partes).arrayBuffer(), urlFinal, bytes };
  }

  /** Descarga común: timeout, límite de tamaño, progreso y errores legibles. */
  async function descargar(url, { signal, onProgreso } = {}) {
    const ctrl = new AbortController();
    const alCancelar = () => ctrl.abort();
    signal?.addEventListener('abort', alCancelar, { once: true });
    let porTiempo = false;
    const timer = setTimeout(() => { porTiempo = true; ctrl.abort(); }, LIMITES.timeoutMs);

    try {
      const resp = await fetch(url.href, {
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'omit',        // nunca enviar cookies a servidores de terceros
        referrerPolicy: 'no-referrer',
      });
      if (!resp.ok) {
        throw new ErrorLista('http', `El servidor respondió con el código ${resp.status}${resp.status === 404 ? ' (la lista no existe en esa dirección)' : ''}.`, resp.status);
      }

      const total = Number(resp.headers.get('content-length')) || 0;
      if (total > LIMITES.maxBytes) throw errorTamano();

      // Lectura por partes: permite mostrar progreso y cortar archivos enormes.
      let bytes = 0;
      const partes = [];
      if (resp.body?.getReader) {
        const lector = resp.body.getReader();
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > LIMITES.maxBytes) {
            lector.cancel();
            throw errorTamano();
          }
          partes.push(value);
          onProgreso?.(bytes, total);
        }
      } else {
        partes.push(await resp.arrayBuffer());
        bytes = partes[0].byteLength;
      }

      return { partes, urlFinal: resp.url || url.href, bytes };
    } catch (err) {
      if (err instanceof ErrorLista) throw err;
      if (porTiempo) throw new ErrorLista('timeout', 'El servidor tardó demasiado en responder. Intenta de nuevo más tarde.');
      if (signal?.aborted) throw new ErrorLista('cancelado', 'Carga cancelada.');
      // fetch lanza TypeError tanto sin internet como cuando el servidor no permite CORS.
      throw new ErrorLista('red', 'No se pudo descargar. Revisa tu conexión a internet o, si la URL es correcta, el servidor no permite que otras webs lo lean (CORS).');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', alCancelar);
    }
  }

  const errorTamano = () =>
    new ErrorLista('tamano', `La lista supera el máximo permitido (${LIMITES.maxBytes / 1024 / 1024} MB).`);

  /* ---------------- Parser M3U ----------------
     Formato típico (iptv-org):
       #EXTM3U
       #EXTINF:-1 tvg-id="TyCSports.ar@SD" tvg-logo="https://…png" group-title="Sports",TyC Sports (720p) [Geo-blocked]
       #EXTVLCOPT:http-referrer=https://ejemplo.com/
       https://servidor/stream/index.m3u8
  ------------------------------------------------ */

  const RE_SALTO = /\r\n|\r|\n/;
  const RE_EXTINF = /^#EXTINF\s*:\s*(-?\d+(?:\.\d+)?)?(.*)$/i;
  // clave="valor"  o  clave=valor (algunas listas omiten las comillas)
  const RE_ATRIBUTO = /([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',]+))/gi;
  const RE_VLCOPT = /^#EXTVLCOPT\s*:\s*http-(referrer|referer|user-agent)\s*=\s*(.+)$/i;
  const RE_EXTGRP = /^#EXTGRP\s*:\s*(.*)$/i;
  const RE_CALIDAD = /\s*\((\d{3,4}[pi]|4k|8k|uhd|fhd|hd|sd)\)/i;    // "(1080p)"
  const RE_ETIQUETA = /\s*\[([^\]]+)\]/g;                            // "[Geo-blocked]", "[Not 24/7]"
  const RE_PAIS_TVGID = /\.([a-z]{2})(?:@|$)/i;                       // "TyCSports.ar@SD" → "ar"
  const RE_HLS_DIRECTO = /^#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/im;

  /** Índice de la coma que separa atributos y nombre, saltando los valores entre comillas dobles. */
  function comaFueraDeComillas(texto) {
    let desde = 0;
    for (;;) {
      const coma = texto.indexOf(',', desde);
      if (coma === -1) return -1;
      const comilla = texto.indexOf('"', desde);
      if (comilla === -1 || coma < comilla) return coma;
      const cierre = texto.indexOf('"', comilla + 1);
      if (cierre === -1) return -1; // comilla sin cerrar: no hay separación fiable
      desde = cierre + 1;
    }
  }

  /** Lee lo que viene después de "#EXTINF:-1": atributos y nombre visible. */
  function leerExtinf(resto) {
    const coma = comaFueraDeComillas(resto);
    const cabecera = coma >= 0 ? resto.slice(0, coma) : resto;
    const attrs = {};
    for (const m of cabecera.matchAll(RE_ATRIBUTO)) {
      attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    }
    return { nombre: coma >= 0 ? resto.slice(coma + 1).trim() : '', attrs };
  }

  /** Ruta (sin dominio, query ni #) en minúsculas, sin crear un objeto URL. */
  function rutaDe(href) {
    const inicio = href.indexOf('/', href.indexOf('//') + 2);
    if (inicio === -1) return '';
    const fin = href.slice(inicio).search(/[?#]/);
    return (fin === -1 ? href.slice(inicio) : href.slice(inicio, inicio + fin)).toLowerCase();
  }

  /** hls | dash | archivo | audio | ts | flv | desconocido */
  function detectarFormato(href) {
    const ruta = rutaDe(href);
    if (/\.m3u8?$/.test(ruta)) return 'hls';
    if (/\.mpd$/.test(ruta)) return 'dash';
    if (/\.(mp4|m4v|webm|mov|ogv)$/.test(ruta)) return 'archivo';
    if (/\.(mp3|aac|m4a|ogg|opus|wav)$/.test(ruta)) return 'audio';
    if (/\.ts$/.test(ruta)) return 'ts';
    if (/\.flv$/.test(ruta)) return 'flv';
    return 'desconocido'; // p. ej. .php que redirige a un .m3u8: se intentará como HLS
  }
  const FORMATOS_INCOMPATIBLES = new Set(['dash', 'ts', 'flv']);

  /** Nombre de respaldo cuando la entrada no trae #EXTINF. */
  function nombreDesdeUrl(href) {
    try {
      const u = new URL(href);
      const archivo = u.pathname.split('/').filter(Boolean).pop() || '';
      let legible = archivo;
      try { legible = decodeURIComponent(archivo); } catch { /* %-codificación inválida */ }
      return `${u.hostname}${legible ? ` · ${legible}` : ''}`;
    } catch {
      return href.slice(0, 80); // URL que el navegador no sabe interpretar: se muestra tal cual
    }
  }

  function crearCanal(entrada, url, opciones, grupoExtgrp, indice) {
    const a = entrada.attrs;
    let nombre = entrada.nombre || a['tvg-name'] || '';

    // Separa las etiquetas [..] y la calidad (..) del nombre visible.
    const etiquetas = [];
    let calidad = null;
    if (nombre.includes('[')) nombre = nombre.replace(RE_ETIQUETA, (_, e) => { etiquetas.push(e.trim()); return ''; });
    if (nombre.includes('(')) nombre = nombre.replace(RE_CALIDAD, (_, c) => { calidad = c; return ''; });
    nombre = nombre.replace(/\s{2,}/g, ' ').trim() || nombreDesdeUrl(url);

    const grupoTexto = a['group-title'] || grupoExtgrp || 'Undefined';
    const grupos = grupoTexto.includes(';')
      ? grupoTexto.split(';').map((g) => g.trim()).filter(Boolean)
      : [grupoTexto.trim() || 'Undefined'];
    if (!grupos.length) grupos.push('Undefined');

    const tvgId = a['tvg-id'] || '';
    const pais = (a['tvg-country'] || (tvgId.match(RE_PAIS_TVGID) || [])[1] || '').slice(0, 2).toUpperCase();
    const formato = detectarFormato(url);
    let geobloqueado = false;
    let no247 = false;
    for (const e of etiquetas) {
      const n = e.toLowerCase();
      if (n.includes('geo')) geobloqueado = true;
      if (n.includes('not 24')) no247 = true;
    }

    // Texto donde busca el buscador (nombre, categorías en inglés y español, país, calidad, sinónimos).
    const baseId = tvgId.split('.')[0];
    const sinonimos = SINONIMOS[baseId.toLowerCase()] || '';
    const busqueda = normalizar(`${nombre} ${grupos.join(' ')} ${grupos.map(traducirGrupo).join(' ')} ${pais} ${calidad || ''} ${baseId} ${sinonimos}`);

    return {
      id: `${indice}-${hash(url)}`,
      nombre,
      calidad,
      etiquetas,
      geobloqueado,
      no247,
      grupos,
      logo: urlSegura(a['tvg-logo'] || a.logo || ''),
      url,
      formato,
      compatible: !FORMATOS_INCOMPATIBLES.has(formato),
      tvgId,
      pais,
      referrer: opciones.referrer || opciones.referer || a['http-referrer'] || a.referrer || null,
      userAgent: opciones['user-agent'] || a['user-agent'] || null,
      busqueda,
      urlCanonica: claveStream(url),
      cats: clasificar({ grupos, busqueda }), // Deportes, Noticias, Películas, Entretenimiento
    };
  }

  /** URL estable para deduplicar streams repetidos sin alterar la URL original de reproduccion. */
  function claveStream(href) {
    try {
      const u = new URL(href);
      u.protocol = u.protocol.toLowerCase();
      u.hostname = u.hostname.toLowerCase();
      u.hash = '';
      if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
      return u.href;
    } catch {
      return href;
    }
  }

  function fusionarDuplicado(destino, entrada) {
    destino.grupos = [...new Set([...destino.grupos, ...entrada.grupos])];
    destino.etiquetas = [...new Set([...destino.etiquetas, ...entrada.etiquetas])];
    destino.geobloqueado = destino.geobloqueado || entrada.geobloqueado;
    destino.no247 = destino.no247 || entrada.no247;
    destino.busqueda = normalizar(`${destino.busqueda} ${entrada.nombre} ${entrada.grupos.join(' ')} ${entrada.pais}`);
    destino.cats = clasificar(destino);
    if (!destino.logo && entrada.logo) destino.logo = entrada.logo;
    if (!destino.tvgId && entrada.tvgId) destino.tvgId = entrada.tvgId;
    if (!destino.pais && entrada.pais) destino.pais = entrada.pais;
  }

  /** Limpia el texto y comprueba que sea una lista M3U. Devuelve el texto limpio. */
  function validarContenido(texto) {
    const limpio = String(texto ?? '').replace(/^﻿/, '');
    const inicio = limpio.trimStart().slice(0, 200);
    if (/^<(!doctype|html|\?xml|head|body)/i.test(inicio)) {
      throw new ErrorLista('formato', 'La URL devolvió una página web (HTML), no una lista M3U. Si es de GitHub, usa el enlace "Raw".');
    }
    if (!/^#EXTM3U/i.test(inicio) && !/^#EXTINF/im.test(limpio.slice(0, 20_000))) {
      throw new ErrorLista('formato', 'El contenido no es una lista M3U válida: falta la cabecera #EXTM3U o las entradas #EXTINF.');
    }
    return limpio;
  }

  /** Resultado para cuando pegaron directamente un stream HLS (.m3u8 de video) y no una lista. */
  function resultadoDirecto(urlBase) {
    const canal = crearCanal({ nombre: nombreDesdeUrl(urlBase), attrs: {} }, urlBase, {}, 'Stream directo', 0);
    canal.formato = 'hls';
    canal.compatible = true;
    return { canales: [canal], grupos: [['Stream directo', 1]], descartados: 0, duplicados: 0, directo: true, epgUrls: [] };
  }

  /**
   * Máquina de estados que procesa la lista línea a línea.
   * La usan tanto el análisis síncrono (Worker) como el análisis por partes.
   */
  function crearProcesador(urlBase) {
    const canales = [];
    const vistos = new Map();
    const epgUrls = [];     // guías declaradas en la cabecera: #EXTM3U x-tvg-url="…" / url-tvg="…"
    let descartados = 0;
    let duplicados = 0;
    let pendiente = null;   // último #EXTINF esperando su URL
    let opciones = {};      // #EXTVLCOPT acumuladas para la próxima URL
    let grupoExtgrp = '';   // #EXTGRP para la próxima URL

    return {
      linea(bruta) {
        const linea = bruta.trim();
        if (!linea) return;

        if (linea.charCodeAt(0) === 35 /* # */) {
          let m;
          if ((m = RE_EXTINF.exec(linea))) pendiente = leerExtinf(m[2] || '');
          else if ((m = RE_VLCOPT.exec(linea))) opciones[m[1].toLowerCase()] = m[2].trim();
          else if ((m = RE_EXTGRP.exec(linea))) grupoExtgrp = m[1].trim();
          else if (/^#EXTM3U/i.test(linea)) {
            // Algunas listas declaran su guía de programación (EPG) en la cabecera; puede haber varias separadas por comas.
            for (const a of linea.matchAll(/\b(?:x-tvg-url|url-tvg|tvg-url)\s*=\s*"([^"]*)"/gi)) {
              for (const u of a[1].split(',')) {
                const segura = urlSegura(u, urlBase);
                if (segura && !epgUrls.includes(segura)) epgUrls.push(segura);
              }
            }
          }
          // #KODIPROP, otras #EXTVLCOPT y comentarios se ignoran.
          return;
        }

        // Línea sin "#": es la URL del flujo (con o sin #EXTINF previo).
        const url = urlSegura(linea, urlBase);
        if (url) {
          const canal = crearCanal(pendiente ?? { nombre: '', attrs: {} }, url, opciones, grupoExtgrp, canales.length);
          const previo = vistos.get(canal.urlCanonica);
          if (previo) {
            duplicados++;
            fusionarDuplicado(previo, canal);
          } else {
            vistos.set(canal.urlCanonica, canal);
            canales.push(canal);
          }
        }
        else descartados++; // rtmp://, udp://, srt://, javascript:, texto basura…
        pendiente = null;
        opciones = {};
        grupoExtgrp = '';
      },

      terminar() {
        // Conteo por categoría, de mayor a menor. Se devuelve como arreglo para poder
        // enviarlo desde el Worker (postMessage copia arreglos de forma eficiente).
        const conteo = new Map();
        for (const c of canales) for (const g of c.grupos) conteo.set(g, (conteo.get(g) || 0) + 1);
        return { canales, grupos: [...conteo].sort((a, b) => b[1] - a[1]), descartados, duplicados, directo: false, epgUrls };
      },
    };
  }

  /**
   * Análisis síncrono. Es el que ejecuta el Worker (fuera del hilo de la interfaz).
   * @param {{ onProgreso?: (hechas:number, total:number) => void }} opciones
   * @returns {{ canales: object[], grupos: Array<[string, number]>, descartados: number, directo: boolean }}
   */
  function parsear(texto, urlBase, { onProgreso } = {}) {
    const limpio = validarContenido(texto);
    if (RE_HLS_DIRECTO.test(limpio.slice(0, 20_000))) return resultadoDirecto(urlBase);

    const lineas = limpio.split(RE_SALTO);
    const proc = crearProcesador(urlBase);
    for (let i = 0; i < lineas.length; i++) {
      proc.linea(lineas[i]);
      if (onProgreso && i % LIMITES.lineasPorTanda === 0) onProgreso(i, lineas.length);
    }
    return proc.terminar();
  }

  /** Cede el hilo al navegador (para que pinte y atienda clics/teclas) entre tandas. */
  const ceder = () => new Promise((r) => setTimeout(r, 0));

  /**
   * Análisis en el hilo principal por tandas de ~12 ms (menos de un cuadro de pantalla),
   * cediendo el control entre ellas para que la página no se congele.
   */
  async function parsearPorPartes(texto, urlBase, { onProgreso, signal } = {}) {
    const limpio = validarContenido(texto);
    if (RE_HLS_DIRECTO.test(limpio.slice(0, 20_000))) return resultadoDirecto(urlBase);

    const lineas = limpio.split(RE_SALTO);
    const proc = crearProcesador(urlBase);
    let inicioTanda = performance.now();
    for (let i = 0; i < lineas.length; i++) {
      proc.linea(lineas[i]);
      if ((i & 255) === 0 && performance.now() - inicioTanda > LIMITES.msPorTanda) {
        onProgreso?.(i, lineas.length);
        await ceder();
        if (signal?.aborted) throw new ErrorLista('cancelado', 'Carga cancelada.');
        inicioTanda = performance.now();
      }
    }
    return proc.terminar();
  }


  /* ---------------- XMLTV (guía de programación) ----------------
     Formato estándar de EPG:
       <tv>
         <channel id="Mega.cl"><display-name>Mega</display-name><icon src="…"/></channel>
         <programme start="20261011210000 -0300" stop="20261011223000 -0300" channel="Mega.cl">
           <title>Meganoticias</title><desc>…</desc><category>News</category>
         </programme>
       </tv>
     Se analiza con expresiones regulares (DOMParser no existe dentro de un Worker)
     y solo se guardan los programas de una ventana de tiempo alrededor de "ahora".
  ------------------------------------------------------------------ */

  const RE_XML_CANAL = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
  const RE_XML_PROGRAMA = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  const RE_XML_NOMBRE = /<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g;
  const RE_ATTR = {
    id: /\bid\s*=\s*"([^"]*)"/,
    start: /\bstart\s*=\s*"([^"]*)"/,
    stop: /\bstop\s*=\s*"([^"]*)"/,
    channel: /\bchannel\s*=\s*"([^"]*)"/,
    src: /\bsrc\s*=\s*"([^"]*)"/,
  };
  const RE_XML_ETIQUETA = {
    title: /<title\b[^>]*>([\s\S]*?)<\/title>/,
    subtitulo: /<sub-title\b[^>]*>([\s\S]*?)<\/sub-title>/,
    desc: /<desc\b[^>]*>([\s\S]*?)<\/desc>/,
    category: /<category\b[^>]*>([\s\S]*?)<\/category>/,
    icon: /<icon\b([^>]*)\/?>/,
  };
  const ENTIDADES_XML = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  /** Quita CDATA y decodifica entidades (&amp;, &#233;, &#xE9;…). */
  function textoXml(s) {
    if (!s) return '';
    return s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] !== '#') return ENTIDADES_XML[e.toLowerCase()] ?? m;
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(n); } catch { return m; }
      })
      .replace(/\s+/g, ' ')
      .trim();
  }

  const atributo = (cabecera, nombre) => (RE_ATTR[nombre].exec(cabecera) || [])[1] || '';
  const etiqueta = (cuerpo, nombre) => textoXml((RE_XML_ETIQUETA[nombre].exec(cuerpo) || [])[1]);

  /** "20261011213000 -0300" → milisegundos UTC. Sin zona horaria se asume UTC (estándar XMLTV). */
  function fechaXmltv(s) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4}|Z)?/.exec(s || '');
    if (!m) return NaN;
    let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7] && m[7] !== 'Z') {
      const minutos = (+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5));
      ms -= (m[7][0] === '-' ? -1 : 1) * minutos * 60_000;
    }
    return ms;
  }

  /**
   * Analiza un XMLTV.
   * @param {{ desde?: number, hasta?: number }} ventana  ms UTC; por defecto de 3 h atrás a 30 h adelante
   * @returns {{ canales: Array<{id, nombres, icono}>, programas: Object<string, Array<[inicio, fin, titulo, subtitulo, desc, categoria, icono]>>, total: number }}
   */
  function parsearXMLTV(texto, { desde = Date.now() - 3 * 3600_000, hasta = Date.now() + 30 * 3600_000 } = {}) {
    if (!/<tv[\s>]/i.test(texto.slice(0, 5000))) {
      throw new ErrorLista('formato', 'El archivo no es una guía XMLTV (falta la etiqueta <tv>).');
    }

    const canales = [];
    for (const m of texto.matchAll(RE_XML_CANAL)) {
      const id = textoXml(atributo(m[1], 'id'));
      if (!id) continue;
      const nombres = [...m[2].matchAll(RE_XML_NOMBRE)].map((x) => textoXml(x[1])).filter(Boolean);
      const icono = urlSegura(textoXml(atributo((RE_XML_ETIQUETA.icon.exec(m[2]) || [])[1] || '', 'src')));
      canales.push({ id, nombres, icono });
    }

    const programas = {};
    let total = 0;
    for (const m of texto.matchAll(RE_XML_PROGRAMA)) {
      const cab = m[1];
      const inicio = fechaXmltv(atributo(cab, 'start'));
      let fin = fechaXmltv(atributo(cab, 'stop'));
      if (Number.isNaN(inicio)) continue;
      if (Number.isNaN(fin)) fin = 0; // se completa luego con el inicio del siguiente programa
      if ((fin || inicio + 6 * 3600_000) <= desde || inicio >= hasta) continue;

      const canal = textoXml(atributo(cab, 'channel'));
      const cuerpo = m[2];
      const desc = etiqueta(cuerpo, 'desc');
      (programas[canal] ||= []).push([
        inicio,
        fin,
        etiqueta(cuerpo, 'title') || 'Sin título',
        etiqueta(cuerpo, 'subtitulo'),
        desc.length > 280 ? `${desc.slice(0, 277)}…` : desc,
        etiqueta(cuerpo, 'category'),
        urlSegura(textoXml(atributo((RE_XML_ETIQUETA.icon.exec(cuerpo) || [])[1] || '', 'src'))),
      ]);
      total++;
    }

    // Orden cronológico y fin implícito = inicio del siguiente (o +2 h si es el último).
    for (const lista of Object.values(programas)) {
      lista.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < lista.length; i++) {
        if (!lista[i][1]) lista[i][1] = lista[i + 1]?.[0] || lista[i][0] + 2 * 3600_000;
      }
    }
    return { canales, programas, total };
  }

  /** Bytes → texto. Detecta gzip (.xml.gz) por su firma 1F 8B y lo descomprime con DecompressionStream. */
  async function textoDesdeBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') {
        throw new ErrorLista('formato', 'Este navegador no puede descomprimir archivos .gz; usa la versión .xml de la guía.');
      }
      const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(flujo).text();
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      throw new ErrorLista('formato', 'Los archivos .zip no son compatibles: descomprímelo y carga el .xml.');
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  /** Bytes de una guía (.xml o .xml.gz) → guía analizada. Funciona en la página y en el Worker. */
  async function procesarGuia(buffer, ventana) {
    return parsearXMLTV(await textoDesdeBuffer(buffer), ventana);
  }

  /* ---------------- Web Worker ---------------- */

  let worker = null;
  let workerRoto = false;
  let siguienteId = 0;
  const pendientes = new Map(); // id → { resolve, reject, onProgreso, alternativa }

  function obtenerWorker() {
    if (worker) return worker;
    if (workerRoto || !URL_SCRIPT || typeof Worker === 'undefined' || global.location?.protocol === 'file:') return null;
    try {
      // Ruta relativa a este script: funciona en Live Server, GitHub Pages (/usuario/repo/) y Netlify.
      // Conserva ?v=… del script para que una publicación nueva no use un worker en caché.
      const urlWorker = new URL('./parser.worker.js', URL_SCRIPT);
      urlWorker.search = new URL(URL_SCRIPT).search;
      worker = new Worker(urlWorker);
    } catch {
      workerRoto = true;
      return null;
    }
    worker.onmessage = ({ data }) => {
      const p = pendientes.get(data.id);
      if (!p) return;
      if (data.tipo === 'progreso') return p.onProgreso?.(data.hechas, data.total);
      pendientes.delete(data.id);
      if (data.tipo === 'ok') p.resolve(data.resultado);
      else p.reject(new ErrorLista(data.codigo || 'formato', data.mensaje || 'No se pudo analizar el archivo.'));
    };
    worker.onerror = (e) => {
      // El Worker no pudo arrancar (archivo ausente, política del navegador…): se analiza en la página.
      e.preventDefault?.();
      console.warn('[IPTV] Worker no disponible; se analiza en el hilo principal.', e.message || '');
      workerRoto = true;
      worker.terminate();
      worker = null;
      const enEspera = [...pendientes.values()];
      pendientes.clear();
      enEspera.forEach((p) => p.alternativa());
    };
    return worker;
  }

  /**
   * Envía un trabajo al Worker; si no hay Worker (o falla al arrancar) ejecuta la alternativa en la página.
   * @param {object} mensaje         { tipo: 'm3u' | 'epg', … }
   * @param {Function} enPrincipal   alternativa en el hilo principal (devuelve una promesa)
   */
  function enSegundoPlano(mensaje, { onProgreso, signal, transferir = [] } = {}, enPrincipal) {
    const principal = () => enPrincipal().then((r) => ({ ...r, motor: 'principal' }));
    const w = obtenerWorker();
    if (!w) return principal();

    return new Promise((resolve, reject) => {
      const id = ++siguienteId;
      pendientes.set(id, {
        resolve: (r) => resolve({ ...r, motor: 'worker' }),
        reject,
        onProgreso,
        alternativa: () => principal().then(resolve, reject),
      });
      signal?.addEventListener('abort', () => {
        if (pendientes.delete(id)) reject(new ErrorLista('cancelado', 'Carga cancelada.'));
      }, { once: true });
      w.postMessage({ ...mensaje, id }, transferir);
    });
  }

  /**
   * Analiza una lista M3U sin bloquear la interfaz: en el Worker si está disponible; si no, por partes.
   * @returns {Promise<{ canales, grupos, descartados, directo, epgUrls, motor: 'worker'|'principal' }>}
   */
  function parsearEnSegundoPlano(texto, urlBase, { onProgreso, signal } = {}) {
    return enSegundoPlano({ tipo: 'm3u', texto, urlBase }, { onProgreso, signal },
      () => parsearPorPartes(texto, urlBase, { onProgreso, signal }));
  }

  /** Analiza una guía XMLTV (bytes .xml o .xml.gz) sin bloquear la interfaz. */
  function procesarGuiaEnSegundoPlano(buffer, ventana = {}, { signal } = {}) {
    // Se guarda una copia para la alternativa: al transferir el buffer al Worker, la página pierde acceso a él.
    const copia = buffer.slice(0);
    return enSegundoPlano({ tipo: 'epg', buffer, ventana }, { signal, transferir: [buffer] },
      () => procesarGuia(copia, ventana));
  }

  /**
   * Flujo completo de una lista: validar URL → descargar → analizar.
   * @param {{ signal?, onDescarga?: (bytes, total) => void, onAnalisis?: (hechas, total) => void }} opciones
   */
  async function cargarLista(textoUrl, { signal, onDescarga, onAnalisis } = {}) {
    const url = prepararUrlLista(textoUrl);
    const { texto, urlFinal, bytes } = await descargarLista(url, { signal, onProgreso: onDescarga });
    const t0 = performance.now();
    const resultado = await parsearEnSegundoPlano(texto, urlFinal, { signal, onProgreso: onAnalisis });
    if (!resultado.canales.length) {
      throw new ErrorLista('vacia', 'La lista se descargó, pero no contiene canales con enlaces http(s) válidos.');
    }
    return { url: url.href, urlFinal, bytes, msAnalisis: Math.round(performance.now() - t0), ...resultado };
  }

  /**
   * Flujo completo de una guía XMLTV desde una URL.
   * @param {{ proxy?: string, signal?, onDescarga?, ventana? }} opciones
   *   proxy: prefijo de un proxy CORS propio. Si contiene "{url}" se reemplaza por la URL codificada;
   *   si no, la URL codificada se agrega al final (ej. "https://mi-proxy.workers.dev/?url=").
   */
  async function cargarGuia(textoUrl, { proxy = '', signal, onDescarga, ventana } = {}) {
    const original = prepararUrlLista(textoUrl);
    let destino = original;
    if (proxy && proxy.trim()) {
      const p = proxy.trim();
      destino = validarUrl(p.includes('{url}') ? p.replace('{url}', encodeURIComponent(original.href)) : p + encodeURIComponent(original.href));
    }
    const { buffer, bytes } = await descargarBinario(destino, { signal, onProgreso: onDescarga });
    const t0 = performance.now();
    const guia = await procesarGuiaEnSegundoPlano(buffer, ventana, { signal });
    return { url: original.href, bytes, msAnalisis: Math.round(performance.now() - t0), ...guia };
  }

  global.ParserM3U = {
    prepararUrlLista,
    validarUrl,
    descargarLista,
    descargarBinario,
    parsear,
    parsearPorPartes,
    parsearEnSegundoPlano,
    cargarLista,
    parsearXMLTV,
    procesarGuia,
    procesarGuiaEnSegundoPlano,
    cargarGuia,
    normalizar,
    traducirGrupo,
    clasificar,
    NOMBRES_CATEGORIA,
    ErrorLista,
  };
})(typeof window !== 'undefined' ? window : self);

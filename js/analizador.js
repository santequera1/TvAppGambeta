/* =============================================================
   GolStream IPTV · analizador.js
   Herramienta local para inspeccionar HTML publico de paginas
   deportivas sin saltar CORS, autenticacion, DRM ni iframes.
   ============================================================= */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const dom = {
    abrir: $('#btn-analizador'),
    dialogo: $('#dialogo-analizador'),
    cerrar: $('#btn-cerrar-analizador'),
    formUrl: $('#form-analizador-url'),
    inputUrl: $('#input-analizador-url'),
    formHtml: $('#form-analizador-html'),
    inputHtml: $('#input-analizador-html'),
    limpiar: $('#btn-limpiar-analizador'),
    exportar: $('#btn-exportar-analizador'),
    estado: $('#estado-analizador'),
    resumen: $('#resumen-analizador'),
    tabla: $('#tabla-analizador'),
  };

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const PATRON_CANAL = /\b(TNT\s*Sports(?:\s*Premium)?(?:\s*CL)?(?:\s*(?:OP|Opcion|Option)\s*\d+)?(?:\s*HD)?|ESPN(?:\s*\d+| Premium)?|DSports(?:\s*\d+)?|TyC\s*Sports|Fox\s*Sports(?:\s*\d+)?|GolTV|Movistar\s*Deportes|Liga\s*1\s*MAX|Win\s*Sports|TUDN|VTV\s*Plus|ECDF|beIN\s*Sports|DAZN|Eurosport)\b/gi;
  const PATRON_HORA = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/g;
  const PATRON_VS = /^([\p{L}\p{N}][\p{L}\p{N}.' -]{1,60}?)\s+(?:vs\.?|v\.?|versus)\s+([\p{L}\p{N}][\p{L}\p{N}.' -]{1,60})$/iu;
  const MULTIMEDIA = /\.(m3u8?|mpd|mp4|webm|m4v|mp3|aac)(?:[?#]|$)/i;
  const MANIFIESTO = /\.(m3u8?|mpd)(?:[?#]|$)/i;

  let ultimoInforme = null;

  function origenSeguro(url, base) {
    if (!url || !String(url).trim()) return null;
    try {
      const u = base ? new URL(url, base) : new URL(url);
      return /^https?:$/.test(u.protocol) ? u : null;
    } catch { return null; }
  }

  function urlRedactada(url) {
    if (!url) return '';
    const u = origenSeguro(url);
    if (!u) return '';
    const ruta = u.pathname.replace(/\/[^/]*(token|key|auth|sig|session|jwt|m3u8?|mpd)[^/]*/ig, '/...');
    return `${u.origin}${ruta}${u.search ? '?…' : ''}`;
  }

  function tipoEnlace(url, etiqueta = '') {
    if (etiqueta === 'IFRAME' || etiqueta === 'EMBED') return 'iframe';
    const ruta = origenSeguro(url)?.pathname || '';
    if (MANIFIESTO.test(ruta)) return 'manifiesto multimedia';
    if (MULTIMEDIA.test(ruta)) return 'media directa';
    return 'pagina';
  }

  function textoVisible(doc) {
    const copia = doc.body?.cloneNode(true);
    if (!copia) return '';
    copia.querySelectorAll('script,style,noscript,svg,template,[hidden],[aria-hidden="true"], [style]').forEach((n) => {
      if (!n.hasAttribute('style') || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(n.getAttribute('style'))) n.remove();
    });
    copia.querySelectorAll('br').forEach((n) => n.replaceWith(' '));
    copia.querySelectorAll('p,div,h1,h2,h3,li,button,a,time,td,section').forEach((n) => n.append(' '));
    return copia.textContent.replace(/\s+/g, ' ').trim();
  }

  function unicos(lista) {
    const vistos = new Set();
    return lista.filter(Boolean).map((x) => String(x).trim()).filter((x) => {
      const clave = normalizar(x).replace(/\s+/g, ' ');
      if (!clave || vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
  }

  function visible(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || n.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.getAttribute('style') || '')) return false;
    }
    return !el.closest('script,style,noscript,template');
  }

  function detectarEquipos(doc, titulo) {
    const out = [];
    const bloques = [...doc.querySelectorAll('h1,h2,h3,p,li,td,[class*="match" i],[class*="event" i]')].filter(visible);
    for (const texto of [titulo, ...bloques.map((el) => el.textContent.trim())]) {
      const m = texto.replace(PATRON_HORA, '').trim().match(PATRON_VS);
      if (!m) continue;
      const a = m[1].trim();
      const b = m[2].trim();
      if (a.length < 3 || b.length < 3) continue;
      out.push(`${a} vs ${b}`);
      if (out.length >= 8) break;
    }
    return unicos(out);
  }

  function detectarCompetencias(doc, texto) {
    const candidatos = [
      ...[...doc.querySelectorAll('.league,.competition,.liga,.torneo,.categoria')]
        .filter((el) => visible(el) && el.children.length === 0 && el.textContent.trim().length <= 80)
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      ...texto.match(/\b(Primera\s+Divisi[oó]n|Liga\s+de\s+Primera|Liga\s+de\s+Ascenso|Copa\s+de\s+la\s+Liga|Supercopa|Copa\s+Chile|Primera\s+B|Copa\s+Libertadores|Copa\s+Sudamericana|Champions\s+League|Premier\s+League|LaLiga|Serie\s+A|Bundesliga)\b/gi) || [],
    ];
    return unicos(candidatos).slice(0, 12);
  }

  function analizarHtml(html, fuente = 'HTML pegado') {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const origen = origenSeguro(fuente);
    const base = origenSeguro(doc.querySelector('base[href]')?.getAttribute('href'), origen?.href)?.href || origen?.href;
    const texto = textoVisible(doc);
    const cabecera = [...doc.querySelectorAll('h1,h2')].find(visible);
    const titulo = (cabecera?.textContent || doc.querySelector('meta[property="og:title"]')?.content || doc.title || '').trim();
    const canales = unicos([...texto.matchAll(PATRON_CANAL)].map((m) => m[0].replace(/\s+/g, ' '))).slice(0, 40);
    const horarios = unicos([...texto.matchAll(PATRON_HORA)].map((m) => m[0])).slice(0, 20);
    const equipos = detectarEquipos(doc, titulo);
    const competencias = detectarCompetencias(doc, texto);
    const iframes = [...doc.querySelectorAll('iframe')].map((el) => ({
      tipo: 'iframe',
      valor: urlRedactada(origenSeguro(el.getAttribute('src'), base)?.href),
      dominio: origenSeguro(el.getAttribute('src'), base)?.hostname || '',
      evidencia: 'observado en HTML',
      detalle: el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('allow') || '',
    }));
    const scripts = [...doc.querySelectorAll('script[src]')].map((el) => {
      const src = el.getAttribute('src') || '';
      return {
        tipo: 'script externo',
        valor: urlRedactada(origenSeguro(src, base)?.href),
        dominio: origenSeguro(src, base)?.hostname || '',
        evidencia: 'observado en HTML',
        detalle: el.type || '',
      };
    });
    const enlaces = [...doc.querySelectorAll('a[href], source[src], video[src], embed[src]')].map((el) => {
      const raw = el.getAttribute('href') || el.getAttribute('src') || '';
      const resuelto = origenSeguro(raw, base);
      const kind = tipoEnlace(resuelto?.href || '', el.tagName);
      return {
        tipo: kind,
        valor: urlRedactada(resuelto?.href),
        dominio: resuelto?.hostname || '',
        evidencia: /multimedia|directa/.test(kind) ? 'inferido por extension; contenido no consultado' : 'observado en HTML',
        detalle: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 90),
      };
    });
    const externos = [...iframes, ...scripts, ...enlaces].filter((x) => x.dominio && x.dominio !== origen?.hostname);
    const dominios = unicos(externos.map((x) => x.dominio)).sort();
    const controles = [...doc.querySelectorAll('a,button,[role="button"],option')].filter((el) => {
      if (!visible(el) || el.querySelector('a,button,[role="button"],option')) return false;
      if (el.closest('nav,header,footer')) return false;
      const etiqueta = el.textContent.replace(/\s+/g, ' ').trim();
      const opcionExplicita = /\b(?:op\s*\d+|opci[oó]n\s*\d+|option\s*\d+|alternativa\s*\d+)\b/i.test(etiqueta);
      const contextoEvento = equipos.length > 0 || el.closest('[class*="alternativ" i],[class*="option" i],[class*="opcion" i]');
      return opcionExplicita || (contextoEvento && new RegExp(PATRON_CANAL.source, 'i').test(etiqueta));
    });
    const alternativas = controles.length;

    return {
      fuente: origen ? urlRedactada(origen.href) : 'HTML pegado',
      generado: new Date().toISOString(),
      tituloEvento: titulo || '(sin titulo detectable)',
      participantes: equipos,
      horarios,
      competiciones: competencias,
      canales,
      alternativasVisibles: alternativas,
      etiquetasAlternativas: controles.map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
      evidencia: {
        tituloEvento: 'observado en HTML; no confirma que sea una pagina de evento',
        canales: 'menciones observadas en texto estatico',
        horarios: 'patron observado; fecha y zona horaria no comprobadas',
        participantes: 'inferidos por separador vs/v/versus; un guion solo no confirma un partido',
        alternativasVisibles: 'controles inferidos por etiqueta; visibilidad CSS externa no comprobada',
        iframes: 'etiquetas observadas; contenido y reproduccion no consultados',
        scriptsExternos: 'src observado; ejecucion y proposito no comprobados',
        dominiosExternos: origen ? 'resueltos respecto al origen de la pagina' : 'origen desconocido; rutas relativas no resueltas',
      },
      iframes: iframes.length,
      scriptsExternos: scripts.length,
      dominiosExternos: dominios,
      elementos: [...iframes, ...scripts, ...enlaces]
        .filter((x) => x.tipo === 'iframe' || x.tipo === 'script externo' || x.valor || x.dominio || x.detalle)
        .slice(0, 250),
      notas: [
        'Los enlaces estan redactados: el informe identifica arquitectura, no redistribuye streams.',
        'Un manifiesto detectado por extension no se marca como reproducido.',
        'No se ejecutan scripts ni se inspecciona contenido de iframes. CSS externo y contenido dinamico no se comprueban.',
      ],
    };
  }

  function pintar(informe) {
    ultimoInforme = informe;
    dom.exportar.disabled = false;
    const tarjetas = [
      ['Evento', informe.tituloEvento],
      ['Canales', informe.canales.length],
      ['Alternativas', informe.alternativasVisibles],
      ['Iframes', informe.iframes],
      ['Scripts', informe.scriptsExternos],
      ['Dominios', informe.dominiosExternos.length],
      ['Horarios', informe.horarios.join(', ') || 'No detectados'],
      ['Participantes', informe.participantes.join(' · ') || 'No detectados'],
    ];
    dom.resumen.hidden = false;
    dom.resumen.innerHTML = tarjetas.map(([k, v]) => `
      <div class="rounded-xl border border-linea bg-fondo p-3">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">${esc(k)}</p>
        <p class="mt-1 truncate text-sm text-white" title="${esc(v)}">${esc(v)}</p>
      </div>`).join('');

    const filas = [
      ...[['tituloEvento', 'titulo', informe.tituloEvento], ['horarios', 'horarios', informe.horarios.join(', ')], ['participantes', 'partidos', informe.participantes.join(' / ')], ['alternativasVisibles', 'alternativas', informe.alternativasVisibles]]
        .map(([campo, tipo, valor]) => ({ tipo, valor, evidencia: informe.evidencia[campo] })),
      ...informe.canales.map((c) => ({ tipo: 'canal mencionado', valor: c, dominio: '', detalle: '', evidencia: informe.evidencia.canales })),
      ...informe.competiciones.map((c) => ({ tipo: 'competicion', valor: c, dominio: '', detalle: '' })),
      ...informe.elementos,
    ];
    dom.tabla.hidden = false;
    dom.tabla.innerHTML = `
      <table class="min-w-full divide-y divide-linea text-left text-xs">
        <thead class="sticky top-0 bg-sup-2 text-slate-400">
          <tr><th class="px-3 py-2 font-semibold">Tipo</th><th class="px-3 py-2 font-semibold">Valor</th><th class="px-3 py-2 font-semibold">Dominio</th><th class="px-3 py-2 font-semibold">Detalle</th><th class="px-3 py-2 font-semibold">Evidencia</th></tr>
        </thead>
        <tbody class="divide-y divide-linea bg-fondo/60">
          ${filas.length ? filas.map((f) => `
            <tr>
              <td class="whitespace-nowrap px-3 py-2 text-cancha">${esc(f.tipo)}</td>
              <td class="max-w-[28rem] truncate px-3 py-2 text-slate-200" title="${esc(f.valor)}">${esc(f.valor)}</td>
              <td class="whitespace-nowrap px-3 py-2 text-slate-400">${esc(f.dominio)}</td>
              <td class="max-w-[22rem] truncate px-3 py-2 text-slate-500" title="${esc(f.detalle)}">${esc(f.detalle)}</td>
              <td class="min-w-[16rem] px-3 py-2 text-slate-400">${esc(f.evidencia || 'inferido del texto')}</td>
            </tr>`).join('') : '<tr><td colspan="5" class="px-3 py-4 text-center text-slate-500">Sin elementos detectados.</td></tr>'}
        </tbody>
      </table>`;
  }

  async function analizarUrl(url) {
    const destino = origenSeguro(url);
    if (!destino || destino.username || destino.password) throw new Error('Ingresa una URL publica HTTP o HTTPS sin credenciales.');
    if (dom.estado) dom.estado.textContent = `Descargando ${destino.hostname}...`;
    let resp;
    try {
      resp = await fetch(destino.href, { mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch {
      throw new Error('El navegador no permite leer la respuesta (posible CORS, red, TLS o contenido mixto). Pega el HTML manualmente.');
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const tipo = resp.headers.get('content-type') || '';
    if (tipo && !/html|text\/plain|application\/xhtml/i.test(tipo)) throw new Error(`La respuesta no parece HTML (${tipo}).`);
    return analizarHtml(await resp.text(), resp.url || destino.href);
  }

  window.GolStreamAnalizador = Object.freeze({ analizarHtml, analizarUrl });
  if (!dom.abrir || !dom.dialogo) return;

  function descargarJson() {
    if (!ultimoInforme) return;
    const blob = new Blob([JSON.stringify(ultimoInforme, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `golstream-analisis-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function limpiar() {
    ultimoInforme = null;
    dom.inputHtml.value = '';
    dom.inputUrl.value = '';
    dom.estado.textContent = '';
    dom.resumen.hidden = true;
    dom.tabla.hidden = true;
    dom.resumen.innerHTML = '';
    dom.tabla.innerHTML = '';
    dom.exportar.disabled = true;
  }

  dom.abrir.addEventListener('click', () => dom.dialogo.showModal());
  dom.cerrar.addEventListener('click', () => dom.dialogo.close());
  dom.dialogo.addEventListener('click', (e) => { if (e.target === dom.dialogo) dom.dialogo.close(); });
  dom.formHtml.addEventListener('submit', (e) => {
    e.preventDefault();
    const html = dom.inputHtml.value.trim();
    if (!html) {
      dom.estado.textContent = 'Pega HTML publico para analizar.';
      return;
    }
    pintar(analizarHtml(html, dom.inputUrl.value.trim() || 'HTML pegado'));
    dom.estado.textContent = 'HTML analizado localmente.';
  });
  dom.formUrl.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const url = dom.inputUrl.value.trim();
      if (!url) throw new Error('Ingresa una URL.');
      const informe = await analizarUrl(url);
      pintar(informe);
      dom.estado.textContent = 'URL analizada. Si faltan datos, pega el HTML manualmente.';
    } catch (err) {
      dom.estado.textContent = `No se pudo analizar desde el navegador: ${err.message}. Pega el HTML manualmente.`;
    }
  });
  dom.limpiar.addEventListener('click', limpiar);
  dom.exportar.addEventListener('click', descargarJson);
})();

(function () {
  'use strict';
  const zona = 'America/Santiago';
  const consulta = document.querySelector('#deportes-consulta');
  const eventos = document.querySelector('#deportes-eventos');
  const plataformas = document.querySelector('#deportes-plataformas');
  const equipo = document.querySelector('#deportes-equipo');
  const periodo = document.querySelector('#deportes-periodo');
  const filtros = [...document.querySelectorAll('[data-deportes-filtro]')];
  if (!consulta || !eventos) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hora = new Intl.DateTimeFormat('es-CL', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dia = new Intl.DateTimeFormat('es-CL', { timeZone: zona, day: 'numeric', month: 'short' });
  const prioritarios = ['Universidad de Chile', 'Colo Colo', 'Universidad Católica'];
  let catalogo;
  let filtroCompeticion = 'todos';

  function enlace(url, texto, clase = '') {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password) return esc(texto);
      return `<span class="${clase}">${esc(texto)}</span>`;
    } catch { return esc(texto); }
  }

  function pintar() {
    if (!catalogo) return;
    const hoy = fecha.format(new Date());
    const moverDia = n => new Date(Date.parse(`${hoy}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const antiguo = Date.now() - Date.parse(catalogo.consultado) > 86400000;
    consulta.textContent = `Consulta: ${dia.format(new Date(catalogo.consultado))} ${hora.format(new Date(catalogo.consultado))} | Chile (${zona})${antiguo ? ' | Sin verificacion reciente' : ''}`;
    const lista = catalogo.eventos.filter(ev => {
      const coincide = equipo.value === 'todos' || (equipo.value === 'prioritarios' ? prioritarios.some(nombre => nombre === ev.local || nombre === ev.visita) : [ev.local, ev.visita].includes(equipo.value));
      const torneo = String(ev.competicion || '').toLowerCase();
      const coincideCompeticion = filtroCompeticion === 'todos' || (filtroCompeticion === 'chile' ? !/libertadores|sudamericana/.test(torneo) : torneo.includes(filtroCompeticion));
      const fechas = periodo.value === 'hoy' ? ev.fechaPublicada === hoy : periodo.value === 'manana' ? ev.fechaPublicada === moverDia(1) : periodo.value === 'recientes' ? ev.fechaPublicada < hoy : periodo.value === 'proximos' ? ev.fechaPublicada >= hoy : ev.fechaPublicada >= hoy && ev.fechaPublicada < moverDia(7);
      return coincide && coincideCompeticion && fechas;
    });
    eventos.innerHTML = lista.length ? `<table class="tabla-deportes w-full text-left text-xs"><thead class="text-slate-500"><tr><th scope="col" class="py-2 pr-3">Partido / competici&oacute;n</th><th scope="col" class="py-2 pr-3">Chile</th><th scope="col" class="py-2">Canal / evidencia</th></tr></thead><tbody class="divide-y divide-linea">${lista.map(ev => {
      const antiguoEvento = Date.now() - Date.parse(ev.consultado) > 86400000;
      const info = antiguoEvento ? 'no verificado' : ev.estadoInformacion;
      const d = ev.inicio ? new Date(ev.inicio) : new Date(`${ev.fechaPublicada}T12:00:00Z`);
      const estado = /pospuesto|suspendido|cancelado/i.test(ev.estadoFuente || '') ? ev.estadoFuente : !ev.inicio ? 'Horario sin confirmar' : Date.now() < Date.parse(ev.inicio) ? 'Próximo' : Date.now() - Date.parse(ev.inicio) < 7200000 ? 'En curso estimado' : 'Finalizado estimado';
      const platform = catalogo.plataformas.find(p => p.id === ev.plataforma);
      return `<tr data-deporte-evento="${esc(ev.id)}">
        <td data-etiqueta="Partido / competición" class="py-3 pr-3 align-top"><div class="flex items-center gap-2">${ev.escudoLocal ? `<img src="${esc(ev.escudoLocal)}" alt="" class="h-6 w-6 shrink-0 object-contain" loading="lazy" referrerpolicy="no-referrer" />` : ''}<span class="min-w-0 font-semibold text-slate-200 break-words">${esc(ev.local)} vs ${esc(ev.visita)}</span></div><p class="mt-1 text-slate-500">${esc(ev.competicion)}${ev.fase ? ` | ${esc(ev.fase)}` : ''} | ${esc(estado)}${ev.resultado ? ` | ${esc(ev.resultado)}` : ''}</p>${ev.paisLocal || ev.paisVisita ? `<p class="text-slate-500">${esc(ev.paisLocal || 'País no identificado')} · ${esc(ev.paisVisita || 'País no identificado')}</p>` : ''}</td>
        <td data-etiqueta="Fecha y hora · Chile" class="py-3 pr-3 align-top"><p>${esc(dia.format(d))}</p><p class="mt-1 ${ev.inicio ? 'text-slate-200' : 'text-amber-400'}">${ev.inicio ? esc(hora.format(d)) : 'Hora sin datos'}</p><p class="mt-1 text-slate-500">${esc(ev.estadoVerificacion || `Agenda: ${info}`)}</p></td>
        <td data-etiqueta="Canal / evidencia" class="py-3 align-top"><p class="text-slate-200">${esc(ev.canalAnunciado || 'Canal sin anuncio verificado')}</p><p class="mt-1 text-slate-500">Canal: ${esc(antiguoEvento && ev.canalAnunciado ? 'no verificado recientemente' : ev.estadoCanal)}</p><p>${esc(ev.confianza)}</p>${ev.etiquetasDirectorio?.length ? `<p>Opciones del directorio (no verificadas): ${esc([...new Set(ev.etiquetasDirectorio)].join(', '))}</p>` : ''}${ev.discrepancias?.length ? '<p>Discrepancias entre fuentes: revisar evidencias.</p>' : ''}${ev.retenido ? '<p>Fuente no actualizada; evidencia anterior.</p>' : ''}<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">${enlace(ev.fuente, ev.tipoFuente === 'oficial' ? 'Fuente oficial' : 'Directorio')}${ev.fuenteCanal ? enlace(ev.fuenteCanal, 'Anuncio del canal') : ''}${platform ? enlace(platform.url, 'Programacion oficial') : ''}</div><details><summary>Evidencias (${ev.evidencias?.length || 1})</summary>${(ev.evidencias || []).map(e => `<p>${enlace(e.fuente, e.tipoFuente || 'Fuente')} · ${esc(e.consultado)} · ${esc(e.inicio || 'Sin hora')}</p>`).join('')}</details></td>
      </tr>`;
    }).join('')}</tbody></table>` : `<p class="py-4 text-sm text-slate-400">Sin eventos en el registro para esta seleccion. ${enlace(catalogo.origen, 'Calendario oficial')}</p>`;
    for (const row of eventos.querySelectorAll('[data-deporte-evento]')) {
      const ev = lista.find(e => e.id === row.dataset.deporteEvento);
      for (const diferencia of ev?.discrepancias || []) row.querySelector('details')?.insertAdjacentHTML('beforeend', `<p class="mt-2">${esc(diferencia.campo)}: ${esc(diferencia.valores.join(' / '))}. ${esc(diferencia.nota || '')} ${(diferencia.fuentes || []).map((url, i) => enlace(url, `Comparar fuente ${i + 1}`)).join(' · ')}</p>`);
    }
    plataformas.innerHTML = catalogo.plataformas.map(p => `<li class="border-l border-linea pl-3"><p>${enlace(p.url, p.nombre)}</p><p class="mt-1 text-slate-500">${esc(p.acceso)}</p><p class="mt-1 text-slate-500">${p.reproduccionProbada ? `HLS probado: ${esc(dia.format(new Date(p.reproduccionConsultada)))}. Integracion no verificada.` : 'Reproduccion directa no comprobada.'}</p></li>`).join('');
  }

  async function cargar() {
    try {
      const r = await fetch('./data/futbol-chileno.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data.eventos) || !Array.isArray(data.plataformas) || !Number.isFinite(Date.parse(data.consultado))) throw new Error('Registro no valido');
      catalogo = data;
      pintar();
    } catch {
      consulta.textContent = 'Catalogo no disponible. Sin datos comprobados.';
      eventos.innerHTML = enlace('https://www.campeonatochileno.cl/', 'Calendario oficial ANFP');
    }
  }
  equipo.addEventListener('change', pintar);
  periodo.addEventListener('change', pintar);
  for (const boton of filtros) boton.addEventListener('click', () => {
    filtroCompeticion = boton.dataset.deportesFiltro;
    for (const item of filtros) item.setAttribute('aria-pressed', String(item === boton));
    pintar();
  });
  // El registro (1,1 MB sin comprimir) solo se descarga cuando la sección llega a la pantalla:
  // nunca compite con el arranque del video.
  let iniciado = false;
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting || iniciado) return;
    iniciado = true; obs.disconnect();
    cargar();
    setInterval(() => { if (!document.hidden) cargar(); }, 30 * 60000);
    setInterval(pintar, 60000);
  }).observe(document.querySelector('#deportes-vivo') || eventos);
})();

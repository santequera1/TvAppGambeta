(function (global) {
  'use strict';
  const etiquetas = { confirmado: 'Reproducción confirmada', 'sin-verificar': 'Sin verificar', temporal: 'Fallo temporal' };
  class EstadosCanales {
    constructor(datos = {}) { this.registros = Array.isArray(datos.canales) ? datos.canales : []; }
    perfil(canal) {
      const id = canal.tvgId?.split('@')[0];
      return this.registros.find(r => r.id === id && r.urlFuente === canal.url) || null;
    }
    minimoMs(canal) {
      // La política de estabilidad permanece aunque el registro no cargue
      // o el proveedor cambie la URL; el estado observado sí exige URL exacta.
      const id = canal.tvgId?.split('@')[0];
      return ['CMBTelevision.co', 'FrecuenciaFTV.co'].includes(id) || this.perfil(canal)?.minimoConfirmacionMs === 60000 ? 60000 : 15000;
    }
    resolver(canal, salud) {
      const perfil = this.perfil(canal);
      const minimo = this.minimoMs(canal);
      let estado = 'sin-verificar', motivo = 'No se ha comprobado reproducción sostenida de esta fuente.';
      if (perfil && perfil.estado === 'temporal') { estado = 'temporal'; motivo = perfil.motivo; }
      if (perfil && perfil.estado === 'restringido') {
        const fecha = Date.parse(perfil.consultado);
        if (Number.isFinite(fecha) && Date.now() - fecha < 86400000 && fecha <= Date.now()) estado = 'restringido';
        motivo = perfil.motivo + ' Observación anterior: ' + perfil.consultado.slice(0, 10) + '.';
      }
      if (salud?.ok === false) {
        estado = salud.clasificacion === 'restringido' ? 'restringido' : salud.clasificacion === 'fallo-reproduccion' || salud.codigo === 'timeout' || salud.codigo === 'red' || /^http-5\d\d$/.test(salud.codigo || '') ? 'temporal' : 'sin-verificar';
        motivo = salud.motivo;
      }
      if (salud?.reproduccion && salud.duracionConfirmadaMs >= minimo) {
        estado = 'confirmado'; motivo = `Video con cuadros y avance durante al menos ${minimo / 1000} segundos.`;
      }
      if (perfil?.estado === 'temporal' && estado !== 'confirmado' && estado !== 'restringido') {
        estado = 'temporal'; motivo = perfil.motivo;
      }
      if (!canal.compatible || (global.location?.protocol === 'https:' && canal.url.startsWith('http:'))) {
        estado = 'restringido'; motivo = 'Esta fuente no es compatible con la reproducción en este navegador/origen.';
      }
      if (estado === 'restringido') estado = 'temporal';
      return { estado, etiqueta: etiquetas[estado], motivo, enlaceOficial: perfil?.enlaceOficial || null };
    }
  }
  global.EstadosCanales = EstadosCanales;
})(window);

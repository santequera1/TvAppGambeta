(function (global) {
  'use strict';
  const texto = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  function identidad(c) {
    // La numeración es parte de la identidad: ESPN 2 nunca es respaldo de ESPN.
    const nombre = texto(c?.nombre).replace(/\([^)]*\)|\b(?:1080p|720p|480p|2160p|fhd|uhd|hd|sd)\b/g, '').replace(/\s+/g, ' ').trim();
    const espn = nombre.match(/^espn(?:\s+([1-7]))?(?:\s+latin america(?: colombia)?|\s+colombia)?$/);
    if (espn) return 'espn:' + (espn[1] || '1');
    const id = c?.tvgId?.split('@')[0];
    return id ? 'id:' + texto(id) : 'nombre:' + nombre;
  }
  function salud(c, destacados, verificador) {
    return destacados.get(c.url) || verificador.estado(c.url);
  }
  function mismoCanal(a, b) {
    return identidad(a) === identidad(b) || identidad({ nombre: a?.nombre }) === identidad({ nombre: b?.nombre });
  }
  function verificado(r) { return r?.ok === true && (r.hlsValido === true || r.reproduciendo === true || r.reproduccion === true || r.motivo === 'manifiesto HLS válido'); }
  function comparar(a, b, destacados, verificador) {
    const sa = salud(a, destacados, verificador), sb = salud(b, destacados, verificador);
    const pa = !a.geobloqueado && verificado(sa) ? (/^espn\b/i.test(a.nombre) ? 0 : 1) : 2;
    const pb = !b.geobloqueado && verificado(sb) ? (/^espn\b/i.test(b.nombre) ? 0 : 1) : 2;
    return pa - pb || (pa < 2 ? (sa.respuestaMs ?? Infinity) - (sb.respuestaMs ?? Infinity) || 0 : 0);
  }
  global.SenalesIPTV = { identidad, mismoCanal, salud, verificado, comparar };
})(window);

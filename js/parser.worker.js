/* =============================================================
   GolStream IPTV · parser.worker.js
   Web Worker: analiza en un hilo aparte, para que la interfaz siga
   fluida con archivos grandes:
     tipo 'm3u' → lista de canales (miles de entradas)
     tipo 'epg' → guía de programación XMLTV (.xml o .xml.gz)
   Reutiliza el mismo motor de parser.js (ruta relativa a este archivo).
   ============================================================= */
importScripts('./parser.js');

self.onmessage = async ({ data }) => {
  const { id, tipo } = data;
  try {
    let resultado;
    if (tipo === 'epg') {
      resultado = await self.ParserM3U.procesarGuia(data.buffer, data.ventana);
    } else {
      resultado = self.ParserM3U.parsear(data.texto, data.urlBase, {
        onProgreso: (hechas, total) => self.postMessage({ id, tipo: 'progreso', hechas, total }),
      });
    }
    self.postMessage({ id, tipo: 'ok', resultado });
  } catch (err) {
    self.postMessage({ id, tipo: 'error', codigo: err.codigo || 'formato', mensaje: err.message || String(err) });
  }
};

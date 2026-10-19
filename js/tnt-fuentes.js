(function (global) {
  'use strict';
  const POSICIONES = ['Principal', 'Alternativa 2', 'Alternativa 3'];

  class GestorFuentesTNT {
    constructor({ cargar, detener = () => {}, onCambio = () => {} }) {
      this.cargar = cargar;
      this.detener = detener;
      this.onCambio = onCambio;
      this.id = 'tnt';
      this.canal = 'TNT Sports Premium';
      this.pais = '';
      this.plataformaOficial = '';
      this.fuentes = POSICIONES.map((nombre, i) => ({ id: ['principal', 'alternativa-2', 'alternativa-3'][i], nombre, url: null, estado: 'no configurada', ultimaVerificacion: null, motivoFallo: null, habilitada: false }));
      this.activa = null;
      this.enUso = false;
      this.version = 0;
      this.intentadas = new Set();
      this.orden = [0, 1, 2];
      this.agotadas = false;
    }

    configurar(config = {}) {
      const estabaEnUso = this.enUso;
      this.cancelar();
      if (estabaEnUso) this.detener();
      this.id = String(config.id || this.id || 'tnt');
      this.canal = String(config.canal || this.canal || 'TNT Sports Premium');
      this.pais = String(config.pais || this.pais || '');
      this.plataformaOficial = String(config.plataformaOficial || this.plataformaOficial || '');
      const vistas = new Set();
      this.fuentes = this.fuentes.map((posicion, i) => {
        const input = config.fuentes?.[i] || {};
        const fuente = { ...posicion, url: null, habilitada: false, estado: 'no configurada', motivoFallo: null, ultimaVerificacion: null };
        if (!input.url) return fuente;
        try {
          const url = new URL(input.url);
          const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
          if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && local)) || !/\.m3u8$/i.test(url.pathname)) throw new Error('Se requiere una URL HLS HTTPS, sin credenciales; HTTP solo en pruebas locales.');
          const verificacion = Date.parse(input.ultimaVerificacion);
          if (input.autorizada !== true || input.verificada !== true || !String(input.evidenciaAutorizacion || '').trim() || !Number.isFinite(verificacion) || verificacion > Date.now() || Date.now() - verificacion > 86400000) throw new Error('Autorizacion o verificacion reciente no documentada.');
          url.hash = '';
          if (vistas.has(url.href)) throw new Error('URL duplicada en otra posicion.');
          vistas.add(url.href);
          Object.assign(fuente, { url: url.href, habilitada: true, estado: 'lista', ultimaVerificacion: input.ultimaVerificacion });
        } catch (error) { fuente.estado = 'no habilitada'; fuente.motivoFallo = error.message; }
        return fuente;
      });
      this.onCambio(this);
    }

    iniciar(indice = 0) {
      if (!Number.isInteger(indice) || !this.fuentes[indice]?.habilitada) return false;
      this.version++;
      this.enUso = true;
      this.agotadas = false;
      this.intentadas.clear();
      this.orden = [indice, (indice + 1) % 3, (indice + 2) % 3];
      this._siguiente();
      return true;
    }

    cancelar() {
      this.version++;
      this.enUso = false;
      this.agotadas = false;
      if (this.activa !== null && this.fuentes[this.activa]?.habilitada && this.fuentes[this.activa].estado !== 'fallida') this.fuentes[this.activa].estado = 'en espera';
      this.activa = null;
      this.onCambio(this);
    }

    _siguiente() {
      const indice = this.orden.find(i => this.fuentes[i].habilitada && !this.intentadas.has(i));
      if (indice === undefined) {
        this.activa = null;
        this.agotadas = true;
        this.onCambio(this);
        return;
      }
      if (this.activa !== null && this.fuentes[this.activa].estado !== 'fallida') this.fuentes[this.activa].estado = 'en espera';
      this.activa = indice;
      this.intentadas.add(indice);
      this.version++;
      const fuente = this.fuentes[indice];
      fuente.estado = 'conectando';
      fuente.motivoFallo = null;
      this.onCambio(this);
      this.cargar({
        id: `${this.id}-${fuente.id}`,
        nombre: `${this.canal} - ${fuente.nombre}`,
        url: fuente.url,
        formato: 'hls',
        compatible: true,
        grupos: ['Sports'],
        cats: ['deportes'],
        pais: this.pais,
        calidad: '',
        tntCanal: this.id,
        tntFuente: fuente.id,
        tntIntento: this.version,
        plataformaOficial: this.plataformaOficial,
      });
    }

    recibir(estado, detalle, canal) {
      if (!this.enUso || this.activa === null) return;
      const fuente = this.fuentes[this.activa];
      if (canal?.tntCanal !== this.id || canal?.tntFuente !== fuente.id || canal?.tntIntento !== this.version || canal?.url !== fuente.url || fuente.estado === 'fallida') return;
      if (estado === 'caido') {
        fuente.estado = 'fallida';
        fuente.ultimaVerificacion = new Date().toISOString();
        fuente.motivoFallo = detalle?.motivo || 'Error fatal del reproductor.';
        const version = this.version;
        // A new load must begin after the player's fatal-error callback finishes.
        queueMicrotask(() => { if (this.enUso && version === this.version) this._siguiente(); });
      } else if (estado === 'reproduciendo') {
        fuente.estado = estado;
        fuente.ultimaVerificacion = new Date().toISOString();
        fuente.motivoFallo = null;
      } else if (['cargando', 'buffering', 'reconectando', 'requiere-clic'].includes(estado)) {
        fuente.estado = estado === 'cargando' ? 'conectando' : estado;
      }
      this.onCambio(this);
    }
  }
  global.GestorFuentesTNT = GestorFuentesTNT;
})(window);

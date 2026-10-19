/* =============================================================
   GolStream IPTV · player.js
   Reproductor sobre HLS.js con manejo de errores:

   - HLS (.m3u8) con hls.js en Chrome, Edge, Firefox y Android;
     HLS nativo en Safari / iPhone.
   - MP4 / WebM / audio directo con el <video> del navegador.
   - Explica por qué falló un stream: CORS, 403 (geobloqueo),
     404 (enlace muerto), formato no compatible, contenido mixto…
   - Reintentos con espera creciente ante cortes en plena emisión
     y recuperación de errores de decodificación.
   - Vigilancia de arranque (no llega video) y de congelamiento.
   - Controles para teclado: pausa (con salto al directo),
     silencio, pantalla completa y Picture-in-Picture.
   ============================================================= */
(function (global) {
  'use strict';

  const CFG = {
    timeoutArranqueMs: 12_000, // sin cuadros en 12 s se pasa al respaldo: esperar más solo retiene al usuario frente a negro
    timeoutCongeladoMs: 12_000, // margen de recuperación antes de abandonar la señal
    maxReintentosRed: 3,        // reintentos ante cortes durante la emisión
  };

  /* hls.js (~410 KB) se sirve desde el mismo dominio y solo se descarga donde hace falta:
     Safari / iPhone usan HLS nativo y nunca lo bajan. */
  let promesaMotor = null;
  function cargarMotorHls() {
    if (global.Hls) return Promise.resolve(global.Hls);
    if (promesaMotor) return promesaMotor;
    promesaMotor = new Promise((resolver, rechazar) => {
      const s = document.createElement('script');
      const version = document.querySelector('meta[name="golstream-version"]')?.content || 'dev';
      s.src = new URL(`./js/vendor/hls.min.js?v=${encodeURIComponent(version)}`, location.href).href;
      s.async = true;
      s.onload = () => (global.Hls ? resolver(global.Hls) : rechazar(new Error('hls.js no disponible')));
      s.onerror = () => { promesaMotor = null; rechazar(new Error('hls.js no cargó')); };
      document.head.appendChild(s);
    });
    return promesaMotor;
  }

  const esSafariOiOS = () => {
    const nav = global.navigator;
    if (!nav) return true;
    const ua = nav.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    return ios || (/Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua));
  };

  // Estimación de ancho de banda de la sesión anterior: el siguiente canal arranca en la calidad
  // correcta en vez de partir de los 500 kbps por defecto de hls.js (menos saltos al cambiar de canal).
  const BW_CLAVE = 'golstream.bw';
  let anchoBanda = 0;
  try { anchoBanda = Number(global.localStorage?.getItem(BW_CLAVE)) || 0; } catch { /* sin memoria */ }

  const NOMBRE_FORMATO = { dash: 'DASH (.mpd)', ts: 'MPEG-TS (.ts)', flv: 'Flash Video (.flv)' };

  /** Traduce el código HTTP que devolvió el servidor del stream a un motivo entendible. */
  function motivoHttp(codigo) {
    if (!codigo) return 'no se pudo acceder a la señal; puede ser red, TLS o CORS (causa sin confirmar)';
    if (codigo === 401 || codigo === 403) return `acceso denegado (${codigo}): puede estar geobloqueado o protegido`;
    if (codigo === 404 || codigo === 410) return `el recurso no está disponible en esta consulta (${codigo}); la emisión del canal no está confirmada`;
    if (codigo >= 500) return `el servidor del canal tiene problemas (${codigo})`;
    return `respuesta inesperada del servidor (${codigo})`;
  }

  class ReproductorIPTV {
    /**
     * @param {HTMLVideoElement} video
     * @param {object} ev  Callbacks opcionales:
     *   onEstado(estado, detalle, canal)
     *     'cargando' | 'reproduciendo' | 'buffering' | 'reconectando'
     *     'caido' | 'silenciado' | 'requiere-clic' | 'detenido'
     *   onCalidades(niveles)   [{ indice, alto, bitrate }]
     *   onNivel(indice, auto)
     */
    constructor(video, ev = {}, configHls = {}) {
      this.video = video;
      this.ev = ev;
      this.configHls = configHls;
      this.hls = null;
      this.canal = null;
      this.sesion = 0;        // invalida callbacks de cargas anteriores
      this.modo = null;       // 'hls' | 'nativo'
      this.reintentosRed = 0;
      this.recuperacionesMedia = 0;
      this.probadoNativo = false;
      this.ultimaRecuperacion = null;
      this.tArranque = null;
      this.tCongelado = null;
      this.tReintento = null;
      this.tProgreso = null;
      this.terminal = true;
      this.diagnostico = null;
      this._escucharVideo();
    }

    /** MSE disponible: hls.js puede funcionar (aunque todavía no se haya descargado). */
    get soportaHls() {
      if (global.Hls) return global.Hls.isSupported();
      const MS = global.ManagedMediaSource || global.MediaSource;
      return !!MS?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
    }

    /** Reproduce un canal del parser: { nombre, url, formato, compatible }. */
    cargar(canal) {
      this._limpiar();
      this.intentoCarga = (this.intentoCarga || 0) + 1;
      this.canal = canal;
      this.terminal = false;
      this.inicio = performance.now();
      this.ultimoTiempo = this.video.currentTime;
      this.ultimoAvance = this.inicio;
      this.ultimosCuadros = 0;
      this.cuadrosReportados = false;
      this.videoConfirmado = false;
      this.progresoConfirmacionMs = 0;
      this.diagnostico = { pais: canal.pais || '', fuente: canal.fuente || 'lista', inicioVideoMs: null,
        congelamientos: 0, bufferingMs: 0, reconexiones: 0, errores: [], resultado: 'cargando' };
      this.probadoNativo = false;
      const { url, formato } = canal;

      // Casos que sabemos de antemano que el navegador no puede reproducir.
      if (!canal.compatible) {
        return this._caido(`formato ${NOMBRE_FORMATO[formato] || formato} no compatible con navegadores (sí con VLC)`, 'formato');
      }
      if (location.protocol === 'https:' && url.startsWith('http:')) {
        return this._caido('el stream usa http:// y esta página https://; el navegador lo bloquea (contenido mixto)', 'mixto');
      }

      this._emit('cargando');
      this._vigilarArranque();
      this.tProgreso = setInterval(() => this._medirProgreso(), 500);

      if (formato === 'archivo' || formato === 'audio') {
        this._cargarNativo(url);
      } else if (this._usarHlsNativo()) {
        this._cargarNativo(url); // Prioridad nativa en Safari / iOS, MSE en Chrome
      } else if (this.soportaHls) {
        this._cargarHls(url);
      } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
        this._cargarNativo(url);
      } else {
        this._caido('este navegador no puede reproducir HLS', 'navegador');
      }
    }

    _usarHlsNativo() {
      const nativo = this.video.canPlayType('application/vnd.apple.mpegurl');
      if (!nativo) return false;
      return esSafariOiOS() || !this.soportaHls;
    }

    reintentar() {
      if (this.canal) this.cargar(this.canal);
    }

    /** -1 = automática; 0..n = calidad fija. */
    setCalidad(nivel) {
      if (this.hls) this.hls.currentLevel = Number(nivel);
    }

    /* ---------------- Controles (teclado / botones) ---------------- */

    get hayVideo() { return !!this.canal && this.video.readyState > 0; }

    /**
     * Pausa o reanuda. Si se reanuda un canal en vivo tras una pausa larga,
     * salta al directo (como un televisor) en vez de seguir con retraso.
     * @returns {boolean|null} true = reproduciendo, false = en pausa, null = no hay video
     */
    alternarPausa() {
      const v = this.video;
      if (!this.hayVideo) return null;
      if (!v.paused) {
        v.pause();
        return false;
      }
      const directo = this.hls?.liveSyncPosition;
      if (directo && v.currentTime < directo - 30) v.currentTime = directo;
      this._reproducir();
      return true;
    }

    /** @returns {boolean} true si quedó en silencio */
    alternarSilencio() {
      this.video.muted = !this.video.muted;
      return this.video.muted;
    }

    get enPantallaCompleta() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    /**
     * Pantalla completa sobre el contenedor (incluye insignias y botones propios).
     * En iPhone, donde solo el <video> puede ir a pantalla completa, usa el modo nativo.
     */
    async alternarPantallaCompleta(contenedor) {
      try {
        if (this.enPantallaCompleta) {
          await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
        } else if (contenedor.requestFullscreen) {
          await contenedor.requestFullscreen({ navigationUI: 'hide' });
        } else if (contenedor.webkitRequestFullscreen) {
          contenedor.webkitRequestFullscreen();
        } else if (this.video.webkitEnterFullscreen) {
          this.video.webkitEnterFullscreen();
        }
      } catch (err) {
        console.warn('[IPTV] Pantalla completa no disponible:', err);
      }
    }

    /** Picture-in-Picture estándar (Chrome, Edge, Safari 13.1+) o el modo propio de Safari antiguo. */
    get soportaPiP() {
      return (!!document.pictureInPictureEnabled && !this.video.disablePictureInPicture)
        || typeof this.video.webkitSetPresentationMode === 'function';
    }

    get enPiP() {
      return document.pictureInPictureElement === this.video || this.video.webkitPresentationMode === 'picture-in-picture';
    }

    /** Lanza un Error con .codigo = 'sin-video' si todavía no hay imagen que mostrar. */
    async alternarPiP() {
      const v = this.video;
      if (this.enPiP) {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else v.webkitSetPresentationMode('inline');
        return;
      }
      if (!this.hayVideo) throw Object.assign(new Error('Aún no hay video'), { codigo: 'sin-video' });
      if (v.requestPictureInPicture) await v.requestPictureInPicture();
      else v.webkitSetPresentationMode('picture-in-picture');
    }

    detener() {
      this._limpiar();
      this.canal = null;
      this._emit('detenido');
    }

    /* ---------------- Internos ---------------- */

    _vigilarArranque() {
      const sesion = this.sesion;
      clearTimeout(this.tArranque);
      this.tArranque = setTimeout(() => {
        if (sesion === this.sesion) this._caido('el canal no envió video a tiempo (puede estar fuera del aire)', 'timeout');
      }, CFG.timeoutArranqueMs);
    }

    _cargarHls(url) {
      const sesion = this.sesion;
      if (!global.Hls) {
        cargarMotorHls().then(() => { if (sesion === this.sesion && !this.terminal) this._cargarHls(url); })
          .catch(() => {
            if (sesion !== this.sesion || this.terminal) return;
            if (this.video.canPlayType('application/vnd.apple.mpegurl')) this._cargarNativo(url);
            else this._caido('no se pudo cargar el motor de video; revisa tu conexión', 'navegador');
          });
        return;
      }
      const Hls = global.Hls;
      const movil = !!global.matchMedia?.('(max-width: 1023px)').matches;
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 8,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferHole: 0.5,
        // Móvil de gama media: menos memoria retenida detrás de la posición actual.
        backBufferLength: movil ? 10 : 30,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        startLevel: -1,
        // No descarga 1080p para un reproductor de 390 px: menos datos, menos cortes en 4G.
        capLevelToPlayerSize: true,
        // Pide el primer fragmento mientras se prepara el buffer: arranque más corto.
        startFragPrefetch: true,
        // Añade el segmento al buffer mientras se descarga (fetch por partes): el primer cuadro
        // aparece antes de terminar de bajar segmentos de 1 MB+ como los de las señales ESPN.
        progressive: typeof global.ReadableStream === 'function' && typeof global.fetch === 'function',
        ...(anchoBanda > 0 ? { abrEwmaDefaultEstimate: anchoBanda } : {}),
        ...this.configHls,
      });
      this.hls = hls;
      this.modo = 'hls';

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        if (sesion !== this.sesion) return;
        this.ev.onCalidades?.(data.levels.map((n, i) => ({ indice: i, alto: n.height, bitrate: n.bitrate })));
        this._reproducir();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        if (sesion === this.sesion) this.ev.onNivel?.(data.level, hls.autoLevelEnabled);
      });

      // El presupuesto de recuperación es por sesión, no se reinicia por fragmento.

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (sesion === this.sesion) this._errorHls(data, url);
      });

      hls.loadSource(url);
      hls.attachMedia(this.video);
    }

    _errorHls(data, url) {
      if (this.terminal) return;
      const status = data.response?.code || data.networkDetails?.status || 0;
      this.diagnostico?.errores.push({ tipo: data.type, detalle: data.details, http: status, fatal: !!data.fatal });
      if (this.diagnostico?.errores.length > 20) this.diagnostico.errores.shift();
      if (data.type === global.Hls.ErrorTypes.NETWORK_ERROR) {
        this.falloRedPendiente = true;
        this._emit('fallo-red');
      }
      const ahora = performance.now();
      if (!data.fatal) {
        // Recupera la misma fuente en silencio, con límite y sin reiniciar en bucle.
        if (this.hls && (this.ultimaRecuperacion == null || ahora - this.ultimaRecuperacion >= 1000)) {
          if (data.type === global.Hls.ErrorTypes.NETWORK_ERROR && this.reintentosRed < CFG.maxReintentosRed) {
            this.ultimaRecuperacion = ahora;
            this.reintentosRed++;
            this.hls.startLoad();
          } else if (data.type === global.Hls.ErrorTypes.MEDIA_ERROR && this.recuperacionesMedia < 2) {
            this.ultimaRecuperacion = ahora;
            this.recuperacionesMedia++;
            this.hls.recoverMediaError();
          }
        }
        return;
      }
      const fallar = (motivo, codigo) => {
        const sesion = this.sesion;
        this._emit('fallo-fatal', { motivo, codigo });
        if (this.sesion === sesion && !this.terminal) this._caido(motivo, codigo);
      };
      const { ErrorTypes, ErrorDetails } = global.Hls;
      const codigo = status;

      if (data.type === ErrorTypes.NETWORK_ERROR) {
        if ([401, 403, 404, 410].includes(codigo)) return fallar(motivoHttp(codigo), `http-${codigo}`);
        // Fallo al pedir el índice del canal: el enlace está caído o bloqueado.
        if (data.details === ErrorDetails.MANIFEST_LOAD_ERROR || data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
          if (codigo === 401 || codigo === 403 || codigo === 404 || codigo === 410) {
            return fallar(motivoHttp(codigo), `http-${codigo}`);
          }
        }
        // La respuesta no era un .m3u8: quizá es un archivo directo (algunos .php devuelven MP4/MP3).
        if (data.details === ErrorDetails.MANIFEST_PARSING_ERROR) {
          if (!this.probadoNativo) {
            this.probadoNativo = true;
            this._destruirHls();
            return this._cargarNativo(url);
          }
          return fallar('la respuesta del servidor no es un stream de video válido', 'formato');
        }
        // Corte en plena emisión → reintento con espera creciente (1 s, 2 s, 4 s).
        if (this.hls && this.reintentosRed < CFG.maxReintentosRed) {
          this.reintentosRed++;
          if (this.diagnostico) this.diagnostico.reconexiones++;
          this._emit('reconectando', { intento: this.reintentosRed, max: CFG.maxReintentosRed });
          const sesion = this.sesion;
          clearTimeout(this.tReintento);
          this.hls.stopLoad();
          this.tReintento = setTimeout(() => {
            if (sesion !== this.sesion || !this.hls) return;
            if (data.details === ErrorDetails.MANIFEST_LOAD_ERROR || data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT) this.hls.loadSource(url);
            else this.hls.startLoad();
          }, 1000 * 2 ** (this.reintentosRed - 1));
          return;
        }
        return fallar(`se perdió la conexión con el canal${codigo ? ` (${codigo})` : ''}`, 'red');
      }

      if (data.type === ErrorTypes.MEDIA_ERROR) {
        // 1.º recuperar; 2.º cambiar códec de audio y recuperar; después, rendirse.
        if (this.hls && this.recuperacionesMedia === 0) {
          this.recuperacionesMedia++;
          return this.hls.recoverMediaError();
        }
        if (this.hls && this.recuperacionesMedia === 1) {
          this.recuperacionesMedia++;
          this.hls.swapAudioCodec();
          return this.hls.recoverMediaError();
        }
        return fallar('el navegador no puede decodificar este video', 'media');
      }

      fallar('error irrecuperable del reproductor', 'otro');
    }

    _cargarNativo(url) {
      this.modo = 'nativo';
      this.video.src = url;
      this._reproducir();
    }

    _reproducir() {
      const sesion = this.sesion;
      const promesa = this.video.play();
      if (!promesa) return;
      promesa.catch((err) => {
        if (sesion !== this.sesion || this.terminal) return;
        if (err.name !== 'NotAllowedError') return; // AbortError al cambiar de canal: se ignora
        // Autoplay con sonido bloqueado: se arranca en silencio (siempre permitido).
        this.video.muted = true;
        this.video.play()
          .then(() => { if (sesion === this.sesion && !this.terminal) this._emit('silenciado'); })
          .catch(() => {
            if (sesion !== this.sesion || this.terminal) return;
            clearTimeout(this.tArranque);
            this._emit('requiere-clic');
          });
      });
    }

    _escucharVideo() {
      const v = this.video;
      v.addEventListener('playing', () => {
        if (this.terminal) return;
        clearTimeout(this.tCongelado);
        this.tCongelado = null;
        if (performance.now() - this.ultimoAvance > 1500) this.progresoConfirmacionMs = 0;
        this.ultimoAvance = performance.now();
      });

      const alEsperar = () => {
        if (!this.canal || this.terminal) return;
        if (this.inicioBuffer == null && this.diagnostico?.inicioVideoMs != null) {
          this.inicioBuffer = performance.now();
          this.diagnostico.congelamientos++;
        }
        this._emit('buffering');
        // waiting/stalled repetidos no amplían el plazo de recuperación.
        if (this.tCongelado != null) return;
        const sesion = this.sesion;
        this.tCongelado = setTimeout(() => {
          if (sesion === this.sesion) this._caido('la señal se congeló y no se recuperó', 'congelado');
        }, CFG.timeoutCongeladoMs);
      };
      v.addEventListener('waiting', alEsperar);
      // Safari emite "stalled" cuando la descarga se detiene con el buffer lleno: no es un corte.
      v.addEventListener('stalled', () => { if (v.readyState < 3) alEsperar(); });

      v.addEventListener('pause', () => {
        clearTimeout(this.tCongelado); this._cerrarBuffer();
        this.tCongelado = null;
        if (!this.terminal && this.diagnostico?.inicioVideoMs != null) {
          this.pausaUsuario = true;
          this.hls?.stopLoad();
        }
      });
      v.addEventListener('play', () => {
        if (this.terminal) return;
        if (this.pausaUsuario && this.hls) this.hls.startLoad();
        this.pausaUsuario = false;
        if (performance.now() - this.ultimoAvance > 1500) this.progresoConfirmacionMs = 0;
        this.ultimoAvance = performance.now();
        if (this.diagnostico?.inicioVideoMs == null) this._vigilarArranque();
      });

      // En modo hls los errores llegan por hls.js; aquí solo el modo nativo.
      v.addEventListener('error', () => {
        if (this.modo !== 'nativo' || !this.canal || !v.error) return;
        const motivo = v.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'el navegador no pudo abrir el stream (enlace caído, bloqueado o formato no soportado)'
          : 'error de red o de decodificación al reproducir';
        this._caido(motivo, 'nativo');
      });
    }

    _caido(motivo, codigo) {
      if (this.terminal) return;
      const resumen = this.diagnostico ? { ...this.diagnostico } : {};
      const error = resumen.errores?.at(-1);
      const iniciado = this.diagnostico?.inicioVideoMs != null;
      const confirmadoAntes = this.videoConfirmado === true;
      this._finalizarDiagnostico('fallido');
      this._limpiar();
      this._emit('caido', { motivo, codigo, iniciado, confirmadoAntes, reconexiones: resumen.reconexiones || 0,
        http: error?.http || 0, tipoHls: error?.tipo, detalleHls: error?.detalle });
    }

    _cerrarBuffer() {
      if (this.inicioBuffer != null && this.diagnostico) this.diagnostico.bufferingMs += Math.round(performance.now() - this.inicioBuffer);
      this.inicioBuffer = null;
    }

    _medirProgreso() {
      const v = this.video;
      if (this.terminal || v.paused) return;
      const ahora = performance.now();
      const cuadros = v.getVideoPlaybackQuality?.().totalVideoFrames || 0;
      // Si el navegador nunca reportó cuadros (métrica en 0, posible en HLS nativo de WebKit),
      // se acepta el avance de currentTime con imagen decodificada en vez de matar un video que sí avanza.
      if (cuadros > 0) this.cuadrosReportados = true;
      const sinMetrica = !this.cuadrosReportados && v.videoWidth > 0;
      if (v.currentTime > this.ultimoTiempo + .05 && v.readyState >= 2 && (cuadros > this.ultimosCuadros || sinMetrica || (v.videoWidth > 0 && !v.getVideoPlaybackQuality) || this.canal?.formato === 'audio')) {
        const intervaloMs = ahora - this.ultimoAvance;
        if (intervaloMs > 1500) this.progresoConfirmacionMs = 0;
        if (this.diagnostico.inicioVideoMs != null && intervaloMs <= 1500) {
          this.progresoConfirmacionMs += Math.min(intervaloMs, (v.currentTime - this.ultimoTiempo) * 1000);
        }
        if (this.falloRedPendiente) {
          this.falloRedPendiente = false;
          this._emit('recuperado');
        }
        this.ultimosCuadros = cuadros;
        this.ultimoTiempo = v.currentTime;
        this.ultimoAvance = ahora;
        this._cerrarBuffer();
        clearTimeout(this.tCongelado);
        this.tCongelado = null;
        clearTimeout(this.tArranque);
        if (this.diagnostico.inicioVideoMs == null) this.diagnostico.inicioVideoMs = Math.round(ahora - this.inicio);
        if (this.diagnostico.resultado !== 'reproduciendo') {
          this.diagnostico.resultado = 'reproduciendo';
          this._emit('reproduciendo');
        }
        const minimoMs = this.canal?.minimoConfirmacionMs === 60000 ? 60000 : 15000;
        if (!this.videoConfirmado && this.canal?.formato !== 'audio' && v.videoWidth > 0 && this.progresoConfirmacionMs >= minimoMs) {
          this.videoConfirmado = true;
          this.diagnostico.videoConfirmado15s = true;
          this.ev.onConfirmacionVideo?.(this.canal, { duracionConfirmadaMs: this.progresoConfirmacionMs });
        }
      } else if (this.diagnostico.inicioVideoMs != null) {
        if (ahora - this.ultimoAvance > 1500 && this.inicioBuffer == null) {
          this.inicioBuffer = this.ultimoAvance;
          this.diagnostico.congelamientos++;
          this._emit('buffering');
        }
        if (ahora - this.ultimoAvance > CFG.timeoutCongeladoMs) this._caido('la señal dejó de avanzar y no se recuperó', 'congelado');
      }
    }

    _finalizarDiagnostico(resultado) {
      if (!this.diagnostico) return;
      this._cerrarBuffer();
      const resumen = { ...this.diagnostico, resultado, intentoCarga: this.intentoCarga, duracionMs: Math.round(performance.now() - this.inicio) };
      this.ev.onDiagnostico?.(resumen);
      this.diagnostico = null;
    }

    _destruirHls() {
      if (this.hls) {
        const estimado = Math.round(this.hls.bandwidthEstimate || 0);
        if (estimado > 0 && Number.isFinite(estimado)) {
          anchoBanda = estimado;
          try { global.localStorage?.setItem(BW_CLAVE, String(estimado)); } catch { /* sin memoria */ }
        }
        this.hls.destroy();
        this.hls = null;
      }
    }

    /** Detiene todo y deja el <video> limpio para la siguiente carga. */
    _limpiar() {
      this._finalizarDiagnostico('detenido');
      this.terminal = true;
      this.sesion++;
      clearTimeout(this.tArranque);
      clearTimeout(this.tCongelado);
      this.tCongelado = null;
      clearTimeout(this.tReintento);
      clearInterval(this.tProgreso);
      this.inicioBuffer = null;
      this.pausaUsuario = false;
      this.falloRedPendiente = false;
      this.ultimaRecuperacion = null;
      this._destruirHls();
      this.modo = null;
      this.reintentosRed = 0;
      this.recuperacionesMedia = 0;
      this.video.removeAttribute('src');
      this.video.load();
      this.ev.onCalidades?.([]);
    }

    _emit(estado, detalle = {}) {
      if (estado === 'buffering' || estado === 'reconectando') {
        if (this.diagnostico) this.diagnostico.resultado = estado;
      }
      this.ev.onEstado?.(estado, { ...detalle, intentoCarga: this.intentoCarga }, this.canal);
    }
  }

  global.ReproductorIPTV = ReproductorIPTV;
  // Fuera de Safari/iOS el motor se descarga en paralelo al resto de la página, sin bloquear el HTML.
  if (typeof global.document?.createElement === 'function' && !esSafariOiOS()
    && (global.ManagedMediaSource || global.MediaSource)) cargarMotorHls().catch(() => {});
})(window);

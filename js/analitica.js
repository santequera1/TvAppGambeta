/* =============================================================
   GolStream IPTV · analitica.js
   Estadísticas de uso con Google Analytics 4 (GA4).

   - Desactivada mientras GA_ID esté vacío (y siempre en localhost / file://).
   - Consent Mode v2: todo empieza "denegado". Con «Aceptar» se activan
     las cookies de Analytics y los datos demográficos agregados de Google
     (edad/género, si se activa Google Signals en la cuenta). Con «Rechazar»
     Google solo recibe avisos anónimos sin cookies.
   - No se envía ningún dato personal: solo eventos de uso (canal visto,
     lista cargada, partido abierto).

   Configuración: pega tu ID de medición de GA4 en GA_ID.
   (analytics.google.com → Administrar → Flujos de datos → Web → "G-…")

   API → window.Analitica
     Analitica.evento(nombre, parametros)   no hace nada si está desactivada
     Analitica.mostrarAviso()                vuelve a abrir el aviso de cookies
   ============================================================= */
(function (global) {
  'use strict';

  const GA_ID = 'G-93K8MKZ5P9'; // propiedad «GolStream IPTV» (analytics.google.com)

  const CLAVE = 'golstream.consentimiento'; // 'si' | 'no'
  const LOCAL = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const ACTIVA = /^G-[A-Z0-9]+$/.test(GA_ID) && !LOCAL;

  const leer = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
  const guardar = (v) => { try { localStorage.setItem(CLAVE, v); } catch { /* almacenamiento bloqueado */ } };

  global.dataLayer = global.dataLayer || [];
  function gtag() { global.dataLayer.push(arguments); }

  function permisos(aceptado) {
    const v = aceptado ? 'granted' : 'denied';
    return { analytics_storage: v, ad_storage: v, ad_user_data: v, ad_personalization: v };
  }

  function iniciar() {
    if (!ACTIVA) return;
    // El consentimiento por defecto se declara ANTES de cargar Google Analytics.
    gtag('consent', 'default', { ...permisos(leer() === 'si'), wait_for_update: 500 });
    gtag('js', new Date());
    // Captura las campañas antes de cualquier cambio de lista. Solo permite UTM:
    // ?lista=, credenciales, hash y metadatos privados no se envían a GA.
    const campana = new URLSearchParams();
    const entrada = new URLSearchParams(location.search);
    for (const clave of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content']) {
      const valor = entrada.get(clave);
      if (valor) campana.set(clave, valor);
    }
    const query = campana.toString();
    gtag('config', GA_ID, { page_location: location.origin + location.pathname + (query ? '?' + query : ''),
      page_referrer: '', page_title: 'GolStream IPTV' });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
    document.head.appendChild(s);
    if (!leer()) mostrarAviso();
  }

  function decidir(aceptado) {
    guardar(aceptado ? 'si' : 'no');
    gtag('consent', 'update', permisos(aceptado));
    const aviso = document.getElementById('aviso-cookies');
    if (aviso) aviso.hidden = true;
  }

  function mostrarAviso() {
    const aviso = document.getElementById('aviso-cookies');
    if (!aviso || !ACTIVA) return;
    aviso.hidden = false;
  }

  /** Recorta textos de listas M3U (GA4 admite hasta 100 caracteres por parámetro). */
  function limpiar(params) {
    const out = {};
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue;
      // Los nombres y metadatos de listas personalizadas también son datos no confiables.
      if (/url|token|password|credential|secret/i.test(k)) continue;
      if (typeof v === 'string' && /https?:\/\/|(?:token|password|secret|authorization)\s*[=:]/i.test(v)) continue;
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
      out[k] = typeof v === 'string' ? v.slice(0, 100) : v;
    }
    return out;
  }

  function evento(nombre, params) {
    if (ACTIVA) gtag('event', nombre, limpiar(params));
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-consentimiento]');
    if (b) decidir(b.dataset.consentimiento === 'si');
    if (e.target.closest('#btn-privacidad')) mostrarAviso();
  });

  // El enlace "Privacidad" solo tiene sentido si las estadísticas están activas.
  document.addEventListener('DOMContentLoaded', () => {
    const enlace = document.getElementById('btn-privacidad');
    if (enlace) enlace.hidden = !ACTIVA;
  });

  global.Analitica = { evento, mostrarAviso, activa: ACTIVA };
  iniciar();
})(window);

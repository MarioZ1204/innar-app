// public/validation-client.js
// Reglas de validación cliente para feedback inmediato. El backend (Joi) sigue
// siendo la fuente de verdad — esto solo evita ida-y-vuelta al servidor.
// Diseñado para usarse desde código existente como funciones globales
// (sin módulos ES) para compatibilidad con `public/app.js` minificado.

(function () {
  'use strict';

  const MIN_PASSWORD_LENGTH = 8;
  const MIN_USERNAME_LENGTH = 4;

  const RX_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const RX_FECHA_ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const RX_SHA512_HEX = /^[a-f0-9]{128}$/i;
  const RX_DIGITOS = /^\d+$/;
  const RX_USERNAME_ALLOWED = /^[a-zA-Z0-9._-]+$/;

  function validatePasswordStrength(value) {
    const issues = [];
    if (!value) return { isValid: false, score: 0, issues: ['empty'], messages: [] };
    let score = 0;
    if (value.length < MIN_PASSWORD_LENGTH) issues.push('length');
    else {
      score += 20;
      if (value.length >= 12) score += 10;
      if (value.length >= 16) score += 10;
    }
    if (/[A-Z]/.test(value)) score += 20; else issues.push('upper');
    if (/[a-z]/.test(value)) score += 20; else issues.push('lower');
    if (/[0-9]/.test(value)) score += 25; else issues.push('number');
    return {
      isValid: issues.length === 0,
      score: Math.min(100, score),
      issues,
      strength: getPasswordStrength(score)
    };
  }

  function getPasswordStrength(score) {
    if (score < 20) return { level: 'Muy débil', color: '#dc2626', icon: '🔴' };
    if (score < 40) return { level: 'Débil', color: '#f97316', icon: '🟠' };
    if (score < 60) return { level: 'Regular', color: '#eab308', icon: '🟡' };
    if (score < 80) return { level: 'Fuerte', color: '#84cc16', icon: '🟢' };
    return { level: 'Muy fuerte', color: '#16a34a', icon: '[OK]' };
  }

  function validateUsername(value) {
    const messages = [];
    if (!value) return { isValid: false, messages: [] };
    if (value.length < MIN_USERNAME_LENGTH) messages.push('Mínimo 4 caracteres');
    if (/\s/.test(value)) messages.push('No puede contener espacios');
    if (!RX_USERNAME_ALLOWED.test(value)) messages.push('Solo letras, números, puntos, guiones y guiones bajos');
    return { isValid: messages.length === 0, messages };
  }

  // Espejo de validaciones del backend (modules/validation-schemas.js)
  function isValidHora(value) {
    return typeof value === 'string' && RX_HHMM.test(value);
  }
  function isValidFechaIso(value) {
    return typeof value === 'string' && RX_FECHA_ISO.test(value);
  }
  function isValidSha512Hex(value) {
    return typeof value === 'string' && RX_SHA512_HEX.test(value);
  }
  function isValidTelefono(value) {
    if (typeof value !== 'string') return false;
    return RX_DIGITOS.test(value) && value.length >= 7 && value.length <= 15;
  }
  function isValidDocumento(value) {
    if (typeof value !== 'string') return false;
    return value.length >= 5 && value.length <= 30;
  }
  function isValidEmail(value) {
    if (typeof value !== 'string') return true; // email opcional
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200;
  }
  function isValidNombre(value) {
    return typeof value === 'string' && value.trim().length >= 2 && value.length <= 150;
  }

  // Utility usado por inputs telefónicos: filtra a dígitos en tiempo real.
  function inputDigitsOnly(event, maxLength) {
    const t = event.target;
    if (!t) return;
    const max = typeof maxLength === 'number' ? maxLength : 10;
    t.value = String(t.value || '').replace(/\D/g, '').slice(0, max);
  }

  window.validation = window.validation || {};
  Object.assign(window.validation, {
    MIN_PASSWORD_LENGTH,
    MIN_USERNAME_LENGTH,
    validatePasswordStrength,
    getPasswordStrength,
    validateUsername,
    isValidHora,
    isValidFechaIso,
    isValidSha512Hex,
    isValidTelefono,
    isValidDocumento,
    isValidEmail,
    isValidNombre,
    inputDigitsOnly
  });

  // Compatibilidad con código existente que las usa como funciones globales
  window.validatePasswordStrength = validatePasswordStrength;
  window.getPasswordStrength = getPasswordStrength;
  window.validateUsername = validateUsername;
})();

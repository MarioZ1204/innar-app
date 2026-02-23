// validation.js - Módulo de validaciones
const MIN_PASSWORD_LENGTH = 8;
const MIN_USERNAME_LENGTH = 4;

/**
 * Validar fortaleza de contraseña
 * Retorna { isValid, score, messages }
 */
function validatePasswordStrength(password) {
  const issues = [];
  let score = 0;

  if (!password) return { isValid: false, score: 0, messages: ['La contraseña es requerida'] };

  // Longitud (min 8 caracteres)
  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push(`Mínimo ${MIN_PASSWORD_LENGTH} caracteres (tienes ${password.length})`);
  } else {
    score += 20;
    if (password.length >= 12) score += 10;
    if (password.length >= 16) score += 10;
  }

  // Mayúsculas
  if (!/[A-Z]/.test(password)) {
    issues.push('Debe contener al menos una mayúscula (A-Z)');
  } else {
    score += 20;
  }

  // Minúsculas
  if (!/[a-z]/.test(password)) {
    issues.push('Debe contener al menos una minúscula (a-z)');
  } else {
    score += 20;
  }

  // Números
  if (!/[0-9]/.test(password)) {
    issues.push('Debe contener al menos un número (0-9)');
  } else {
    score += 20;
  }

  // Caracteres especiales
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    issues.push('Debe contener al menos un símbolo especial (!@#$%^&* etc)');
  } else {
    score += 20;
  }

  // Evitar patrones comunes
  const commonPatterns = ['123', '000', 'abc', 'aaa', 'password', 'adminmvbn'];
  if (commonPatterns.some(p => password.toLowerCase().includes(p))) {
    issues.push('Contiene patrones muy comunes o predecibles');
    score = Math.max(0, score - 20);
  }

  return {
    isValid: issues.length === 0,
    score: Math.min(100, score),
    messages: issues,
    strength: getPasswordStrength(score)
  };
}

/**
 * Obtener nivel de fortaleza
 */
function getPasswordStrength(score) {
  if (score < 20) return { level: 'Muy débil', color: '#dc2626', icon: '🔴' };
  if (score < 40) return { level: 'Débil', color: '#f97316', icon: '🟠' };
  if (score < 60) return { level: 'Regular', color: '#eab308', icon: '🟡' };
  if (score < 80) return { level: 'Fuerte', color: '#84cc16', icon: '🟢' };
  return { level: 'Muy fuerte', color: '#16a34a', icon: '🟢🟢' };
}

/**
 * Validar username
 */
function validateUsername(username) {
  const issues = [];

  if (!username) return { isValid: false, messages: ['El usuario es requerido'] };

  // Longitud
  if (username.length < MIN_USERNAME_LENGTH) {
    issues.push(`Mínimo ${MIN_USERNAME_LENGTH} caracteres (tienes ${username.length})`);
  }

  // Sin espacios
  if (/\s/.test(username)) {
    issues.push('No puede contener espacios');
  }

  // Solo alfanuméricos y guiones/puntos
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    issues.push('Solo se permiten letras, números, puntos, guiones y guiones bajos');
  }

  return {
    isValid: issues.length === 0,
    messages: issues
  };
}

/**
 * Validar email (opcional)
 */
function validateEmail(email) {
  if (!email) return { isValid: true, messages: [] }; // Es opcional

  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = regex.test(email);

  return {
    isValid,
    messages: isValid ? [] : ['Email inválido']
  };
}

/**
 * Validar teléfono (opcional)
 */
function validatePhone(phone) {
  if (!phone) return { isValid: true, messages: [] }; // Es opcional

  const cleaned = phone.replace(/\D/g, '');
  const isValid = cleaned.length >= 10 && cleaned.length <= 15;

  return {
    isValid,
    messages: isValid ? [] : ['Teléfono debe tener entre 10 y 15 dígitos']
  };
}

module.exports = {
  validatePasswordStrength,
  validateUsername,
  validateEmail,
  validatePhone,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
  getPasswordStrength
};

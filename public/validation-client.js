// validation-client.js - Validaciones en el cliente
const MIN_PASSWORD_LENGTH = 8;
const MIN_USERNAME_LENGTH = 4;

function validatePasswordStrength(password) {
  const issues = [];
  let score = 0;

  if (!password) return { isValid: false, score: 0, messages: [] };

  // Longitud
  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push('length');
  } else {
    score += 20;
    if (password.length >= 12) score += 10;
    if (password.length >= 16) score += 10;
  }

  // Mayúsculas
  if (!/[A-Z]/.test(password)) {
    issues.push('upper');
  } else {
    score += 20;
  }

  // Minúsculas
  if (!/[a-z]/.test(password)) {
    issues.push('lower');
  } else {
    score += 20;
  }

  // Números
  if (!/[0-9]/.test(password)) {
    issues.push('number');
  } else {
    score += 25;
  }

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
  return { level: 'Muy fuerte', color: '#16a34a', icon: '✅' };
}

function validateUsername(username) {
  const issues = [];

  if (!username) return { isValid: false, messages: [] };

  if (username.length < MIN_USERNAME_LENGTH) {
    issues.push(`Mínimo ${MIN_USERNAME_LENGTH} caracteres`);
  }

  if (/\s/.test(username)) {
    issues.push('No puede contener espacios');
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    issues.push('Solo letras, números, puntos, guiones y guiones bajos');
  }

  return {
    isValid: issues.length === 0,
    messages: issues
  };
}

// utils/password.js
// Helpers para el flujo de contraseñas con doble hash:
// 1) Cliente (public/app.js): hashPassword(plain) = CryptoJS.SHA512(plain).toString()
//    -> envía hash hex de 128 chars al servidor.
// 2) Servidor: bcrypt.hashSync(clientHash, 10) al persistir.
//    Login: bcrypt.compareSync(clientHash, stored_hash).
//
// Esta capa intermedia SHA-512 no aporta seguridad real frente a HTTPS + bcrypt,
// pero está integrada en producción. La validamos estrictamente para evitar que
// cualquier byte "se cuele" como contraseña sin pasar por el hash del cliente.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SHA512_HEX_LEN = 128;
const SHA512_HEX_REGEX = /^[a-f0-9]{128}$/i;

function isValidClientHash(value) {
  return typeof value === 'string' && SHA512_HEX_REGEX.test(value);
}

function hashClientPassword(plain) {
  return crypto.createHash('sha512').update(String(plain)).digest('hex');
}

function hashForStorage(clientHash) {
  if (!isValidClientHash(clientHash)) {
    throw new Error('Hash de contraseña con formato inválido');
  }
  return bcrypt.hashSync(clientHash, 10);
}

function compareClientHash(clientHash, storedHash) {
  if (!isValidClientHash(clientHash) || typeof storedHash !== 'string') return false;
  try {
    return bcrypt.compareSync(clientHash, storedHash);
  } catch (_) {
    return false;
  }
}

function generarPasswordTemporal(length = 12) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alfabeto[bytes[i] % alfabeto.length];
  return out;
}

function hashTemporalParaAlmacenar(passwordPlana) {
  return hashForStorage(hashClientPassword(passwordPlana));
}

module.exports = {
  SHA512_HEX_LEN,
  SHA512_HEX_REGEX,
  isValidClientHash,
  hashClientPassword,
  hashForStorage,
  compareClientHash,
  generarPasswordTemporal,
  hashTemporalParaAlmacenar
};

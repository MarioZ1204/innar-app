const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Intentar con OpenSSL en Git Bash (si está disponible)
const opensslPath = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';

if (fs.existsSync(opensslPath)) {
  try {
    const cmd = `"${opensslPath}" req -x509 -newkey rsa:2048 -keyout server.key -out server.crt -days 365 -nodes -subj "/C=AR/ST=Buenos Aires/L=Buenos Aires/O=Innar/CN=localhost"`;
    execSync(cmd, { cwd: __dirname, stdio: 'inherit' });
    console.log('✓ Certificado generado exitosamente');
  } catch (e) {
    console.error('Error generando certificado:', e.message);
    process.exit(1);
  }
} else {
  console.error('OpenSSL no encontrado. Por favor instala Git con OpenSSL o usa WSL.');
  process.exit(1);
}

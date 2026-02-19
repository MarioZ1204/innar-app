// init-db.js - Script para crear base de datos y tablas en MySQL
require('dotenv').config();
const mysql = require('mysql2');
const bcrypt = require('bcrypt');

async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    // Conectar sin especificar BD
    const conn = mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true
    });

    conn.connect((err) => {
      if (err) {
        console.error('❌ Error conectando a MySQL:', err.message);
        reject(err);
        return;
      }

      console.log('🔌 Conectado a MySQL');

      const dbName = process.env.DB_NAME || 'innar_clinica';

      // Crear BD (sin password_hash en quoted text)
      const createDbQuery = `CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;

      conn.query(createDbQuery, (err) => {
        if (err) {
          console.error('❌ Error creando BD:', err.message);
          conn.end();
          reject(err);
          return;
        }

        console.log(`✓ Base de datos "${dbName}" lista`);

        // Seleccionar BD
        conn.changeUser({ database: dbName }, (err) => {
          if (err) {
            console.error('❌ Error seleccionando BD:', err.message);
            conn.end();
            reject(err);
            return;
          }

          // Crear todas las tablas
          const allTablesSQL = `
            CREATE TABLE IF NOT EXISTS usuarios (
              id INT AUTO_INCREMENT PRIMARY KEY,
              usuario VARCHAR(100) UNIQUE NOT NULL,
              password_hash VARCHAR(255) NOT NULL,
              nombre VARCHAR(150),
              rol ENUM('doctor', 'recepcion', 'admin', 'electro') NOT NULL DEFAULT 'recepcion',
              activo TINYINT DEFAULT 1,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_usuario (usuario)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS pacientes (
              id INT AUTO_INCREMENT PRIMARY KEY,
              nombre VARCHAR(200) NOT NULL,
              documento VARCHAR(50),
              telefono VARCHAR(20),
              email VARCHAR(100),
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_nombre (nombre),
              INDEX idx_documento (documento)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS consultorios (
              id INT AUTO_INCREMENT PRIMARY KEY,
              nombre VARCHAR(100) NOT NULL,
              ubicacion VARCHAR(200),
              activo TINYINT DEFAULT 1,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_nombre (nombre)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS turnos (
              id INT AUTO_INCREMENT PRIMARY KEY,
              numero_turno INT,
              doctor_id INT,
              paciente_nombre VARCHAR(200) NOT NULL,
              paciente_documento VARCHAR(50),
              paciente_telefono VARCHAR(20),
              fecha DATE NOT NULL,
              hora TIME NOT NULL,
              estado ENUM('PENDIENTE', 'EN_SALA', 'EN_ATENCION', 'COMPLETADO', 'CANCELADO', 'ATENDIDO', 'NO_ASISTIO', 'REPROGRAMADO') NOT NULL DEFAULT 'PENDIENTE',
              tipo_consulta TEXT,
              entidad VARCHAR(200),
              notas TEXT,
              telefono TEXT,
              programado_por TEXT,
              oportunidad INT,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE SET NULL,
              INDEX idx_fecha (fecha),
              INDEX idx_doctor_fecha (doctor_id, fecha),
              INDEX idx_estado (estado)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS doctor_agenda (
              id INT AUTO_INCREMENT PRIMARY KEY,
              doctor_id INT NOT NULL,
              fecha DATE NOT NULL,
              hora_inicio TIME NOT NULL,
              hora_fin TIME,
              disponible TINYINT DEFAULT 1,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
              INDEX idx_doctor_fecha (doctor_id, fecha),
              UNIQUE KEY unique_slot (doctor_id, fecha, hora_inicio)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS doctor_agenda_files (
              id INT AUTO_INCREMENT PRIMARY KEY,
              doctor_id INT NOT NULL,
              filename VARCHAR(255) NOT NULL,
              url VARCHAR(500) NOT NULL,
              uploaded_by INT,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (doctor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
              FOREIGN KEY (uploaded_by) REFERENCES usuarios(id) ON DELETE SET NULL,
              INDEX idx_doctor_id (doctor_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS equipos_electro (
              id INT AUTO_INCREMENT PRIMARY KEY,
              nombre VARCHAR(100) NOT NULL,
              descripcion TEXT,
              activo TINYINT DEFAULT 1,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_nombre (nombre)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS citas_electro (
              id INT AUTO_INCREMENT PRIMARY KEY,
              equipo_id INT NOT NULL,
              paciente_id INT NOT NULL,
              fecha DATE NOT NULL,
              hora_inicio TIME NOT NULL,
              hora_fin TIME,
              estudio VARCHAR(255),
              observaciones TEXT,
              estado ENUM('PROGRAMADO', 'REALIZADO', 'CANCELADO') NOT NULL DEFAULT 'PROGRAMADO',
              editado_por_nombre VARCHAR(150),
              editado_en TIMESTAMP,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              FOREIGN KEY (equipo_id) REFERENCES equipos_electro(id) ON DELETE CASCADE,
              FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
              INDEX idx_fecha (fecha),
              INDEX idx_equipo_fecha (equipo_id, fecha),
              INDEX idx_estado (estado)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS recibos (
              id INT AUTO_INCREMENT PRIMARY KEY,
              numero VARCHAR(50),
              cliente VARCHAR(200),
              fecha DATE NOT NULL,
              total DECIMAL(10, 2) NOT NULL,
              data LONGTEXT,
              creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_fecha (fecha),
              INDEX idx_numero (numero)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
          `;

          conn.query(allTablesSQL, (err) => {
            if (err) {
              console.error('❌ Error creando tablas:', err.message);
              conn.end();
              reject(err);
              return;
            }

            console.log('✓ Tablas creadas');

            // Verificar usuarios
            conn.query('SELECT COUNT(*) as count FROM usuarios', (err, results) => {
              if (err) {
                console.error(err);
                conn.end();
                reject(err);
                return;
              }

              if (results[0].count === 0) {
                bcrypt.hash('123456', 10, (hashErr, hash) => {
                  if (hashErr) {
                    console.error('❌ Error hasheando password:', hashErr.message);
                    conn.end();
                    reject(hashErr);
                    return;
                  }

                  const insertUsersSQL = `
                    INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ('admin', '${hash.replace(/'/g, "\\'")}', 'Administrador', 'admin');
                    INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ('doctor', '${hash.replace(/'/g, "\\'")}', 'Doctor de Prueba', 'doctor');
                    INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ('recepcion', '${hash.replace(/'/g, "\\'")}', 'Recepcionista de Prueba', 'recepcion');
                  `;

                  conn.query(insertUsersSQL, (err) => {
                    if (err) {
                      console.error('❌ Error insertando usuarios:', err.message);
                      conn.end();
                      reject(err);
                      return;
                    }
                    console.log('✓ Usuarios creados (admin/doctor/recepcion - contraseña: 123456)');
                    conn.end();
                    console.log('✅ Base de datos inicializada correctamente');
                    resolve();
                  });
                });
              } else {
                console.log(`✓ ${results[0].count} usuarios existentes`);
                conn.end();
                console.log('✅ Base de datos lista');
                resolve();
              }
            });
          });
        });
      });
    });
  });
}

if (require.main === module) {
  initializeDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { initializeDatabase };

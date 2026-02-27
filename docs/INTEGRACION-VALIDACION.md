# 📋 PASOS PRÁCTICOS - Integración de Validación

## Cómo Agregar Validación a tus Endpoints

### Ejemplo 1: POST /api/usuarios (Crear Usuario)

#### Antes (Sin Validación) ❌
```javascript
app.post('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Confiar que los datos están bien... ❌
    const { usuario, nombre, apellido, email, rol, contrasena } = req.body;
    
    // Validaciones manuales (repetidas) 😞
    if (!usuario || usuario.length < 3) {
      return res.status(400).json({ error: 'Usuario inválido' });
    }
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Email inválido' });
    }
    if (!['admin', 'doctor', 'recepcion'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    if (contrasena.length < 8) {
      return res.status(400).json({ error: 'Contraseña muy corta' });
    }
    
    // Finalmente crear usuario...
    const hashedPassword = await bcrypt.hash(contrasena, 10);
    await pool.query(
      'INSERT INTO usuarios VALUES (...)',
      [usuario, nombre, apellido, email, rol, hashedPassword]
    );
    
    res.json({ message: 'Usuario creado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

#### Después (Con Validación) ✅
```javascript
const { validateSchema } = require('./modules/validation-schemas');

app.post('/api/usuarios', 
  requireAuth, 
  requireAdmin,
  validateSchema('crearUsuario'),  // ← UNA LÍNEA, ¡LISTO!
  async (req, res) => {
    try {
      // req.body ya está validado, limpio y tipado ✓
      const { usuario, nombre, apellido, email, rol, contrasena } = req.body;
      
      // Directamente crear
      const hashedPassword = await bcrypt.hash(contrasena, 10);
      await pool.query(
        'INSERT INTO usuarios VALUES (...)',
        [usuario, nombre, apellido, email, rol, hashedPassword]
      );
      
      res.json({ message: 'Usuario creado' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);
```

**Cambios:**
1. `-` Remover validaciones manuales (8 líneas)
2. `+` Agregar import del validateSchema
3. `+` Agregar middleware: `validateSchema('crearUsuario')`
4. **Total:** `+30 líneas → 3 líneas`, código mucho más limpio

---

### Ejemplo 2: POST /api/turnos (Crear Turno)

```javascript
const { validateSchema } = require('./modules/validation-schemas');

// Antes
app.post('/api/turnos', async (req, res) => {
  const { fecha, hora, doctor_id, paciente_nombre } = req.body;
  
  // Validaciones manuales...
  if (!fecha || !isValidDate(fecha)) return res.status(400)...
  if (!hora || !isValidHour(hora)) return res.status(400)...
  if (!doctor_id || !Number.isInteger(doctor_id)) return res.status(400)...
  // ... etc
  
  // Crear turno...
});

// Después (3 líneas, mucho más limpio)
app.post('/api/turnos', 
  validateSchema('crearTurno'),  // ← Validación automática
  async (req, res) => {
    const { fecha, hora, doctor_id, paciente_nombre } = req.body;
    
    // Crear turno (datos ya validados)...
  }
);
```

---

### Ejemplo 3: GET /api/turnos (Búsqueda con Filtro)

```javascript
const { validateSchema } = require('./modules/validation-schemas');

// GET con validación (menos común pero posible)
app.get('/api/turnos',
  validateSchema('filtroTurnos'),  // Valida query params
  async (req, res) => {
    const { fecha_inicio, fecha_fin, doctor_id, page = 1, limit = 20 } = req.body;
    // req.body tiene defaults: page=1, maxLimit=20
    
    const offset = (page - 1) * limit;
    
    const [turnos] = await pool.query(
      'SELECT * FROM turnos WHERE fecha BETWEEN ? AND ? LIMIT ? OFFSET ?',
      [fecha_inicio, fecha_fin, limit, offset]
    );
    
    res.json(turnos);
  }
);
```

---

### Ejemplo 4: POST /api/citas-electro (Con Transacción)

```javascript
const { validateSchema } = require('./modules/validation-schemas');
const { withTransaction } = require('./utils/transactions');

app.post('/api/citas-electro',
  validateSchema('crearCitaElectro'),  // ← Validar entrada
  async (req, res) => {
    try {
      // req.body completamente validado
      const citaData = req.body;
      
      // Usar en transacción segura
      const result = await withTransaction(async (conn) => {
        // Crear cita
        const [citaResult] = await conn.execute(
          'INSERT INTO citas_electro SET ?',
          [citaData]
        );
        
        // Actualizar disponibilidad
        await conn.execute(
          'UPDATE equipos SET disponible = FALSE WHERE id = ?',
          [citaData.equipo_id]
        );
        
        return { citaId: citaResult.insertId };
      }, 'Crear cita electro');
      
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);
```

---

## 🔧 Integración Paso a Paso

### Paso 1: Importar validateSchema
```javascript
// Al inicio de server.js
const { validateSchema } = require('./modules/validation-schemas');
```

### Paso 2: Agregar Middleware
```javascript
// En cada endpoint POST/PUT
app.post('/api/endpoint',
  validateSchema('schemaName'),  // ← Aquí
  async (req, res) => {
    // código existente
  }
);
```

### Paso 3: Remover Validaciones Manuales
```javascript
// BORRAR esta sección:
if (!email || !email.includes('@')) {
  return res.status(400).json({ error: '...' });
}
// Joi ya lo valida
```

### Paso 4: Verificar Tests
```bash
npm test  # Verifica que todo funciona
```

---

## 📋 Checklist de Schemas por Endpoint

```
Auth:
  ✓ POST /api/login                    → validateSchema('login')
  ✓ POST /api/cambiar-contrasena       → validateSchema('cambiarContrasena')

Usuarios:
  ✓ POST /api/usuarios                 → validateSchema('crearUsuario')
  ✓ PUT /api/usuarios/:id              → validateSchema('actualizarUsuario')

Turnos:
  ✓ POST /api/turnos                   → validateSchema('crearTurno')
  ✓ GET /api/turnos                    → validateSchema('filtroTurnos')
  ✓ PUT /api/turnos/:id                → validateSchema('actualizarTurno')

Citas Electro:
  ✓ POST /api/citas-electro            → validateSchema('crearCitaElectro')
  ✓ PUT /api/citas-electro/:id         → validateSchema('actualizarCitaElectro')

Diagnósticos:
  ✓ POST /api/diagnosticos             → validateSchema('crearDiagnostico')
  ✓ PUT /api/diagnosticos/:id          → validateSchema('actualizarDiagnostico')

Recibos:
  ✓ POST /api/recibos                  → validateSchema('crearRecibo')
  ✓ PUT /api/recibos/:id               → validateSchema('actualizarRecibo')

Disponibilidad:
  ✓ POST /api/doctor-disponibilidad    → validateSchema('crearDisponibilidad')
```

---

## 🚨 Manejo de Errores de Validación

Cuando validación falla, la respuesta es automática:

```json
HTTP 422 Unprocessable Entity
{
  "error": "Validación fallida",
  "details": [
    {
      "field": "email",
      "message": "email debe ser válido"
    },
    {
      "field": "rol",
      "message": "rol debe ser admin, doctor, recepcion o gerente"
    }
  ]
}
```

**Ya no necesitas manejar errores de validación en el código.** 

Simplemente devuelve error 500 si falla inserción en BD.

---

## 💡 Tips Útiles

### Tip 1: Validación Manual en Lógica Compleja
```javascript
const { validate } = require('./modules/validation-schemas');

// En tu función de lógica
const result = validate('crearTurno', turnoData);

if (!result.valid) {
  logger.error('Turno inválido', { errors: result.error });
  return null;
}

// result.data tiene datos limpios
return result.data;
```

### Tip 2: Crear Nuevo Schema
```javascript
// En modules/validation-schemas.js
schemas.miNuevoSchema = Joi.object({
  campo1: Joi.string().required(),
  campo2: Joi.number().positive(),
  // ...
});

// Usar en endpoint
app.post('/api/algo', validateSchema('miNuevoSchema'), handler);
```

### Tip 3: Extender Schema Existente
```javascript
// Reutilizar base y agregar campos
const baseSchema = schemas.crearUsuario;
const doctorSchema = baseSchema.append({
  licencia_medica: Joi.string().required(),
  especialidad: Joi.string().required()
});
```

---

## ✅ Resultado Esperado

**Antes de Validación:**
- Validaciones duplicadas en endpoints
- Inconsistencia en mensajes de error
- Difícil de mantener
- Sin documentación clara

**Después de Validación:**
- Validación centralizada
- Errores consistentes
- Fácil de mantener
- Documentación automática (schemas =docs)

---

## 🎯 Próximos Pasos

1. Integrar validateSchema() en **todos los endpoints POST/PUT** (2-3 horas)
2. Remover validaciones manuales (código más limpio)
3. Ejecutar tests: `npm test` (debe pasar 100%)
4. Verificar con Postman que errores de validación funcionan

---

## 📞 Referencia Rápida

### Imports
```javascript
const { validateSchema, validate } = require('./modules/validation-schemas');
```

### Usar como Middleware
```javascript
app.post('/api/endpoint', validateSchema('schemaName'), handler);
```

### Usar Manual
```javascript
const result = validate('schemaName', data);
if (result.valid) {
  // Procesar result.data
}
```

### Ver Schemas Disponibles
```javascript
const { schemas } = require('./modules/validation-schemas');
console.log(Object.keys(schemas));  // Lista todos
```

---

## 🎓 Conclusión

Con validación centralizada:
- ✅ API más segura
- ✅ Código más limpio
- ✅ Menos bugs
- ✅ Mejor UX (errores claros)
- ✅ Fácil de mantener
- ✅ Listo para producción

**¡Empezá hoy mismo!** 🚀

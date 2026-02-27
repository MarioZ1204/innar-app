# Validación de Schemas con Joi

## 🎯 Objetivo

Validar todos los datos de entrada de la API de manera centralizada y consistente usando **Joi**.

Beneficios:
- ✅ Validación centralizada (un lugar para todas las reglas)
- ✅ Mensajes de error claros y consistentes
- ✅ Seguridad contra datos inválidos
- ✅ Documentación automática de campos esperados
- ✅ Fácil de mantener y extender

---

## 📦 Instalación

Ya instalado:
```bash
npm install joi --save
```

---

## 🏗️ Estructura

```javascript
modules/
└── validation-schemas.js
    ├── schemas (20+ schemas para diferentes operaciones)
    ├── validateSchema() - Middleware para Express
    └── validate() - Función utilitaria para validación manual
```

---

## 📋 Schemas Disponibles

### Authentication
- **login** - Validar credenciales de usuario
- **cambiarContrasena** - Validar cambio de contraseña

### Usuarios  
- **crearUsuario** - Crear usuario (admin, doctor, recepción)
- **actualizarUsuario** - Actualizar datos del usuario

### Turnos
- **crearTurno** - Crear turno médico
- **actualizarTurno** - Actualizar turno

### Citas Electro
- **crearCitaElectro** - Crear cita para estudios electro
- **actualizarCitaElectro** - Actualizar cita electro

### Diagnósticos
- **crearDiagnostico** - Crear diagnóstico
- **actualizarDiagnostico** - Actualizar diagnóstico

### Recibos
- **crearRecibo** - Crear recibo/factura
- **actualizarRecibo** - Actualizar recibo

### Disponibilidad
- **crearDisponibilidad** - Crear disponibilidad del doctor
- **agregarIntervaloBloqueado** - Bloquear hora de doctor

### Búsquedas
- **searchPacientes** - Buscar pacientes
- **filtroTurnos** - Filtrar turnos (con paginación)

---

## 💡 Cómo Usar

### Como Middleware en Express (Recomendado)

```javascript
const { validateSchema } = require('./modules/validation-schemas');

// En server.js
app.post('/api/usuarios', 
  requireAuth, 
  requireAdmin,
  validateSchema('crearUsuario'),  // ← Valida req.body
  async (req, res) => {
    // req.body ya está validado y limpio
    const usuario = req.body;
    
    // Insertar en BD...
  }
);
```

**Flujo de ejecución:**
1. `req` llega con body sin validar
2. `validateSchema('crearUsuario')` middleware ejecuta
3. Si falla validación → respuesta 422 con errores detallados
4. Si pasa → `req.body` actualizado con datos limpios
5. Controlador procesa datos validados

### Validación Manual

```javascript
const { validate } = require('./modules/validation-schemas');

// En cualquier función
const result = validate('crearTurno', {
  fecha: '2026-03-15',
  hora: '14:30',
  doctor_id: 5,
  paciente_nombre: 'Carlos García'
});

if (result.valid) {
  console.log('Datos válidos:', result.data);
} else {
  console.log('Errores:', result.error);
  // Salida: [
  //   { field: 'paciente_email', message: 'email es inválido' },
  //   { field: 'estado', message: '...' }
  // ]
}
```

---

## 📝 Ejemplos por Tipo

### Ejemplo 1: Login (Simple)
```javascript
const { validate } = require('./modules/validation-schemas');

const result = validate('login', {
  usuario: 'admin',
  contrasena: 'mypassword123'
});

// Valida:
// - usuario: alfanumérico
// - contrasena: mínimo 8 caracteres
```

### Ejemplo 2: Crear Usuario (Complejo)
```javascript
const result = validate('crearUsuario', {
  usuario: 'dr.sanchez',
  nombre: 'Roberto',
  apellido: 'Sánchez',
  email: 'rsanchez@clinica.com',
  rol: 'doctor',
  especialidad: 'Cardiología',
  numero_consultorio: 3,
  contrasena: 'SecurePass2026!'
});

// Valida:
// - usuario: alfanumérico, 3-50 caracteres
// - email: formato válido
// - rol: solo valores permitidos (admin/doctor/recepcion/gerente)
// - contrasena: mínimo 8 caracteres
```

### Ejemplo 3: Crear Cita Electro (Con Enum)
```javascript
const result = validate('crearCitaElectro', {
  fecha: '2026-03-20',
  hora_inicio: '09:00',
  hora_fin: '09:30',
  paciente_dni: '12345678',
  paciente_nombre: 'María López',
  paciente_edad: 45,
  estado: 'Programado',  // Debe ser uno de: Programado, En Sala, En Estudio, Completado, No Asistió, Cancelado
  equipo_id: null  // Permite null
});
```

### Ejemplo 4: Búsqueda con Paginación (Con Defaults)
```javascript
const result = validate('filtroTurnos', {
  fecha_inicio: '2026-03-01',
  fecha_fin: '2026-03-31',
  doctor_id: 5,
  page: 2,
  limit: 50
});

// Si no se especifica:
// - page: 1 (default)
// - limit: 20 (default)
// - limit máximo: 100
```

---

## 🚨 Error Responses

Cuando la validación falla, la respuesta es:

```json
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

**Status HTTP:** 422 (Unprocessable Entity)

---

## 📏 Reglas de Validación

### Por Tipo

#### Strings
```javascript
Joi.string()
  .required()           // Obligatorio
  .min(3)              // Mínimo 3 caracteres
  .max(100)            // Máximo 100 caracteres
  .email()             // Debe ser email válido
  .alphanum()          // Solo letras y números
  .pattern(/regex/)    // Debe coincidir patrón
```

#### Numbers
```javascript
Joi.number()
  .required()          // Obligatorio
  .integer()           // Debe ser entero
  .positive()          // Debe ser positivo
  .min(0)              // Menor que
  .max(100)            // Mayor que
```

#### Dates
```javascript
Joi.date()
  .iso()              // Formato YYYY-MM-DD
  .required()         // Obligatorio
```

#### Enums
```javascript
Joi.string()
  .valid('admin', 'doctor', 'recepcion')
  .required()
```

#### Arrays
```javascript
Joi.array()
  .items(Joi.object({  // Cada item debe ser objeto
    nombre: Joi.string().required()
  }))
  .required()
```

#### Optional vs Required
```javascript
Joi.string().required()     // Debe estar presente
Joi.string().optional()     // Puede estar o no
Joi.string().allow(null)    // Puede ser null
```

---

## 🧪 Tests

Los tests verifican:
- ✅ Datos válidos aceptados correctamente
- ✅ Datos inválidos rechazados
- ✅ Mensajes de error claros
- ✅ Campos desconocidos removidos
- ✅ Todos los schemas definidos

**Ejecutar tests:**
```bash
npm test -- validation.test.js
```

**Resultado esperado:**
```
PASS  __tests__/validation.test.js
  Validation Schemas
    Login Schema
      ✓ should accept valid login
      ✓ should reject empty usuario
      ✓ should reject short password
      ...
Tests:  27 passed, 27 total ✓
```

---

## 🔌 Integración en Endpoints

### Antes (Sin validación)
```javascript
app.post('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
  // Confiar que los datos están bien ❌
  const { usuario, email, rol } = req.body;
  
  // Implementar validaciones manuales 😞
  if (!usuario || usuario.length < 3) {
    return res.status(400).json({ error: 'Usuario inválido' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  // ... más validaciones repetidas ...
});
```

### Después (Con validación)
```javascript
const { validateSchema } = require('./modules/validation-schemas');

app.post('/api/usuarios', 
  requireAuth, 
  requireAdmin,
  validateSchema('crearUsuario'),  // ← Validación centralizada ✓
  async (req, res) => {
    // req.body ya está 100% validado
    // Datos limpios, seguros y tipados
  }
);
```

---

## 📊 Cuándo Usar Cada Opción

| Caso | Usar |
|------|------|
| Endpoint POST/PUT | `validateSchema()` middleware |
| Lógica interna | `validate()` función |
| Búsqueda/Filtro | `validate()` + defaults |
| Transacción BD | `validate()` antes de writear |

---

## ✨ Best Practices

1. **Centralizar schemas** - Todos en validation-schemas.js
2. **Usar middleware** - En endpoints públicos
3. **Validar siempre** - Incluso datos internos
4. **Mensajes claros** - Usuarios entienden qué está mal
5. **Documentar campos** - Los schemas actúan como docs

---

## 📈 Próximas Mejoras

- [ ] Custom error messages en español
- [ ] Validación de campos dependientes
- [ ] Rate limiting por validación fallida
- [ ] Auditoría de intentos de validación
- [ ] OpenAPI/Swagger auto-generado del schema

---

## 🔗 Referencias

- [Joi Documentation](https://joi.dev/)
- [Joi API](https://joi.dev/api/)
- Tests: `__tests__/validation.test.js`
- Usage: `modules/validation-schemas.js`

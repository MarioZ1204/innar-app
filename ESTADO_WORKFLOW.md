# Flujo de Estados de Citas Electrodiagnóstico

## Estados Disponibles
- `Programado` - Estado inicial (creación automática)
- `En Estudio` - Estudio en proceso (transición automática al presionar "Iniciar")
- `Completado` - Estudio finalizado (transición automática al presionar "Finalizar")
- `En Sala` - Paciente en sala (cambio manual)
- `No Asistió` - Paciente no asistió (cambio manual)
- `Cancelado` - Cita cancelada (cambio manual)

## Transiciones Permitidas

```
┌──────────────┐
│ PROGRAMADO   │  (Estado inicial - se crea aquí automáticamente)
└──────┬───────┘
       │
       │ Presiona "Iniciar" (validando capacidad)
       │ (máx 4 estudios simultáneos)
       ▼
┌──────────────┐
│ EN ESTUDIO   │  (Estudio en proceso)
└──────┬───────┘
       │
       │ Presiona "Finalizar"
       ▼
┌──────────────┐
│ COMPLETADO   │  (Estudio terminado)
└─────────────┘

┌──────────────────────────────────────┐
│ CAMBIOS MANUALES (desde cualquier    │
│ estado):                              │
│ - En Sala                            │
│ - No Asistió                         │
│ - Cancelado                          │
└──────────────────────────────────────┘
```

## Validaciones de Capacidad

### Al Crear Cita (POST /api/citas-electro)
```
1. Cliente envía: paciente_id, fecha, hora, duracion
2. Servidor calcula: hora_fin = hora + duracion (default: 30 min)
3. Consulta: COUNT(*) de citas donde:
   - fecha = misma fecha
   - estado IN ('En Estudio', 'Completado')
   - horarios se solapan: NOT (hora_fin <= start OR hora >= end)
4. Si count >= 4:
   - Respuesta: 409 "Sin capacidad disponible"
5. Si count < 4:
   - Respuesta: 201 Cita creada
```

### Al Cambiar a "En Estudio" (PATCH /api/citas-electro/:id + estado=En Estudio)
```
1. Cliente envía: estado = 'En Estudio', hora_inicio = ahora
2. Servidor válida transición: 'Programado' → 'En Estudio'
3. Consulta: COUNT(*) de citas donde:
   - fecha = misma fecha
   - id != cita actual
   - estado IN ('En Estudio', 'Completado')
   - horarios se solapan con rango [hora_agendamiento, hora_fin]
4. Si count >= 4:
   - Respuesta: 409 "Sin capacidad disponible"
5. Si count < 4:
   - Actualiza: estado = 'En Estudio', hora_inicio = ahora
   - Respuesta: 200 OK
   - Emite: socket.io 'electro:estudio-iniciado'
```

## Responsabilidades de Cada Rol

### Recepción
- Crear citas (`POST /api/citas-electro`)
- Ver citas
- Cambiar a "En Sala", "No Asistió", "Cancelado" (manual)

### Electrodiagnóstico
- Presionar "Iniciar" → Cambiar a "En Estudio"
- Presionar "Finalizar" → Cambiar a "Completado"
- Cambiar a "En Sala", "No Asistió", "Cancelado" (manual)

### Administrador
- Acceso total a todas las funciones
- Eliminar citas

## Ejemplos de Uso

### Ejemplo 1: Crear y ejecutar una cita exitosamente
```
1. Recepción crea cita para 2026-02-26 10:00 (30 min duracion)
   - Hay 2 estudios activos en [10:00, 10:30) → Permitido ✅
   - Cita creada con estado "Programado"

2. Electrodiagnóstico presiona "Iniciar"
   - Hay 3 estudios activos en [10:00, 10:30) → Permitido ✅
   - Cambio: "Programado" → "En Estudio", hora_inicio = 10:05

3. Electrodiagnóstico presiona "Finalizar"
   - Cambio: "En Estudio" → "Completado", hora_fin = 10:32
```

### Ejemplo 2: Crear una cita cuando capacidad está llena
```
1. Recepción crea cita para 2026-02-26 14:00 (30 min)
   - Ya hay 4 estudios activos en [14:00, 14:30) → Rechazado ❌
   - Respuesta: 409 "Sin capacidad disponible"
   - Recepción debe cambiar hora o fecha
```

### Ejemplo 3: Cambiar estado manualmente
```
1. Recepción crea cita
   - Estado: "Programado"

2. Electrodiagnóstico cambia manualmente a "En Sala"
   - Cambio: "Programado" → "En Sala" ✅

3. Electrodiagnóstico cambia a "No Asistió"
   - Cambio: "En Sala" → "No Asistió" ✅
```

## Campos en Base de Datos

```sql
citas_electro:
- id: INT PRIMARY KEY
- fecha: DATE (YYYY-MM-DD)
- hora_agendamiento: TIME (HH:MM) - hora programada
- hora_inicio: TIME NULL (HH:MM) - hora real de inicio
- hora_fin: TIME NULL (HH:MM) - hora real de fin
- estado: ENUM('Programado', 'En Sala', 'En Estudio', 'Completado', 'No Asistió', 'Cancelado')
- editado_por_nombre: VARCHAR
- editado_en: TIMESTAMP
```

## API Endpoints

### Crear Cita
```http
POST /api/citas-electro
Content-Type: application/json

{
  "paciente_id": 123,
  "fecha": "2026-02-26",
  "hora": "10:00",
  "duracion": 30,
  "estudio": "EMG",
  "diagnostico_id": 45,
  "estado": "Programado",
  "programado_por_nombre": "Usuario"
}

Response 201:
{
  "ok": true,
  "id": 567,
  "capacity_info": {
    "active_studies": 2,
    "max": 4,
    "available": 1
  }
}

Response 409:
{
  "error": "Sin capacidad disponible en este horario",
  "details": "Hay 4 estudios activos en este rango. Máximo permitido: 4",
  "capacity": { "active": 4, "max": 4 }
}
```

### Cambiar Estado
```http
PATCH /api/citas-electro/:id
Content-Type: application/json

{
  "estado": "En Estudio",
  "hora_inicio": "10:05"
}

Response 200:
{
  "ok": true,
  "transicion": "Programado → En Estudio"
}

Response 409:
{
  "error": "Sin capacidad disponible en este horario",
  "details": "Hay 4 estudios activos en este rango. Máximo permitido: 4",
  "capacity": { "active": 4, "max": 4 }
}
```

## Socket.io Events

- `electro:cita-creada` - Nueva cita creada
- `electro:estudio-iniciado` - Estudio iniciado
- `electro:estudio-finalizado` - Estudio finalizado
- `electro:cita-actualizada` - Cita actualizada
- `electro:actualizar-lista` - Recargar lista de citas

---

**Versión:** 1.0 (2026-02-26)
**Estado:** ✅ Implementado y validado

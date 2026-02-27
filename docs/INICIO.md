# 🚀 INICIO RÁPIDO

## Opción 1: HTTP (más simple)
```bash
npm start
```
Accede a: http://localhost:3000

---

## Opción 2: HTTPS (recomendado)
```bash
# Generar certificado
node utils/generate-cert.js

# Cambiar en .env: USE_HTTPS=true

# Iniciar
npm start
```
Accede a: https://localhost:3000 (ignorar advertencia de navegador)

---

## Comandos útiles

| Comando | Qué hace |
|---------|----------|
| `npm start` | Inicia servidor HTTP |
| `$env:USE_HTTPS="true"; npm start` | Inicia con HTTPS |
| `node utils/backup.js` | Crea backup manual |
| `node utils/backup.js list` | Ve backups disponibles |
| `node utils/generate-cert.js` | Genera certificado |
| `Get-Content logs/app.log -Tail 50` | Ve logs |

---

## ✅ Verificar que funciona

1. **Servidor arrancó:**
   - Terminal debe mostrar "OK"
   - Sin errores rojos

2. **Acceder en navegador:**
   - http://localhost:3000 carga

3. **Crear cita (test transacciones):**
   ```bash
   curl -X POST http://localhost:3000/api/citas-electro \
     -H "Content-Type: application/json" \
     -d '{"paciente_id":1,"fecha":"2024-01-25","hora_agendamiento":"10:00"}'
   ```
   - Debe devolver: `{"ok":true,"id":X}`

4. **Backups:**
   ```bash
   node utils/backup.js list
   ```
   - Debe mostrar lista de backups

---

## ❌ Si hay error

Ver [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

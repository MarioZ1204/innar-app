# Suite de Tests con Jest

## 🎯 Objetivo

Ejecutar tests automáticos para verificar que:
- ✅ El sistema de logging funciona correctamente
- ✅ Las transacciones hacen commit/rollback
- ✅ La estructura del proyecto es correcta
- ✅ Los headers de seguridad están presentes

## 📦 Instalación

Jest ya está instalado como devDependency:
```bash
npm install --save-dev jest
```

## ▶️ Ejecutar Tests

### Todos los tests
```bash
npm test
```

### Con watch (re-ejecuta al cambiar archivos)
```bash
npm run test:watch
```

### Con cobertura
```bash
npm run test:coverage
```

## 📋 Tests Disponibles

### 1. Logger Tests (`__tests__/logger.test.js`)
- ✅ Crear carpeta logs si no existe
- ✅ Log de información a app.log
- ✅ Log de errores a errors.log + app.log
- ✅ Log de warnings
- ✅ Log de success
- ✅ Log de API/Requests
- ✅ Debug mode (activo/inactivo)
- ✅ Leer últimas líneas de logs

**Ejecución:**
```bash
npm test -- __tests__/logger.test.js
```

### 2. Transactions Tests (`__tests__/transactions.test.js`)
- ✅ Iniciar transacción
- ✅ Ejecutar operación
- ✅ Hacer commit
- ✅ Rollback en error
- ✅ Liberar conexión siempre
- ✅ Ejecutar múltiples queries
- ✅ Rollback si una query falla

**Ejecución:**
```bash
npm test -- __tests__/transactions.test.js
```

### 3. Security Tests (`__tests__/security.test.js`)
- ✅ Helmet.js configurado
- ✅ Headers de seguridad presentes
- ✅ USE_HTTPS configurado
- ✅ Session middleware presente

**Ejecución:**
```bash
npm test -- __tests__/security.test.js
```

### 4. Project Structure Tests (`__tests__/project-structure.test.js`)
- ✅ Directorios requeridos existen
- ✅ Archivos core presentes
- ✅ Funciones del logger exportadas
- ✅ Funciones del transaction exportadas
- ✅ Jest configurado
- ✅ package.json tiene scripts de test

**Ejecución:**
```bash
npm test -- __tests__/project-structure.test.js
```

## 📊 Resultados Esperados

```
 PASS  __tests__/logger.test.js
  Logger System
    ✓ create logs directory if it does not exist (3 ms)
    ✓ info() should log message to app.log (3 ms)
    ... 7 más

 PASS  __tests__/transactions.test.js
  Transactions System
    withTransaction
      ✓ should start, execute and commit a transaction (9 ms)
    ... 6 más

 PASS  __tests__/security.test.js
  ... 6 tests

 PASS  __tests__/project-structure.test.js
  ... 10 tests

Test Suites: 4 passed, 4 total
Tests:       32 passed, 32 total
Time:        3.568 s
```

## 🔧 Configuración

### jest.config.js
- **Entorno:** Node.js
- **Reporte:** Verbose (detallado)
- **Timeout:** 10 segundos por test
- **Archivos:** `__tests__/**/*.test.js` o `*.test.js`

### jest.setup.js
Configura variables de entorno para testing:
```javascript
NODE_ENV = 'test'
DEBUG_MODE = 'false'
DB_NAME = 'innar_clinica_test' // No usa BD real
```

## 📝 Escribir Nuevos Tests

### Template
```javascript
// __tests__/nueva-feature.test.js
const feature = require('../utils/feature');

describe('Feature Name', () => {
  test('should do something', () => {
    const result = feature.doSomething();
    expect(result).toBe(expectedValue);
  });

  test('should handle error', () => {
    expect(() => feature.throwError()).toThrow();
  });
});
```

### Comandos Útiles
```javascript
// Assertions comunes
expect(value).toBe(expected)           // igualdad estricta
expect(value).toEqual(object)          // igualdad profunda
expect(func).toHaveBeenCalled()        // fue llamado
expect(array).toHaveLength(5)          // longitud
expect(string).toContain('text')       // contiene
expect(() => func()).toThrow('error')  // lanza error
```

## 🚀 CI/CD Integration

Los tests pueden integrarse con GitHub Actions:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
```

## 📈 Cobertura

Para ver qué líneas de código están probadas:
```bash
npm run test:coverage

# Genera reporte en coverage/
open coverage/lcov-report/index.html
```

## ⚠️ Troubleshooting

### Tests no ejecutan
```bash
# Limpiar caché
npm test -- --clearCache

# Reinstalar
rm -rf node_modules
npm install
```

### Error: Cannot find module
Asegurar que:
- Jest está instalado: `npm list jest`
- jest.config.js existe en raíz
- jest.setup.js existe en raíz
- Rutas son relativas al raíz del proyecto

### Timeout
Aumentar timeout en `jest.config.js`:
```javascript
testTimeout: 30000 // 30 segundos
```

## Próximos Pasos

- [ ] Tests de endpoints HTTP (supertest)
- [ ] Tests de validación de datos
- [ ] Tests de BD reales (TestContainers)
- [ ] Tests de Socket.io
- [ ] Integración con CI/CD

## Referencias

- [Jest Docs](https://jestjs.io/)
- [Testing Library](https://testing-library.com/)
- [Mocking Node Modules](https://jestjs.io/docs/manual-mocks)

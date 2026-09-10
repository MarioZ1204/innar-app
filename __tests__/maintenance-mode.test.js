const fs = require('fs');
const path = require('path');

describe('modo mantenimiento', () => {
  const flagPath = path.join(process.cwd(), 'maintenance.flag');
  const prevEnv = process.env.MAINTENANCE_MODE;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = prevEnv;
    if (fs.existsSync(flagPath)) fs.unlinkSync(flagPath);
    jest.resetModules();
  });

  test('detecta MAINTENANCE_MODE en entorno', () => {
    process.env.MAINTENANCE_MODE = 'true';
    const { isMaintenanceActive } = require('../config/maintenance');
    expect(isMaintenanceActive()).toBe(true);
  });

  test('detecta maintenance.flag', () => {
    delete process.env.MAINTENANCE_MODE;
    fs.writeFileSync(flagPath, 'on', 'utf8');
    const { isMaintenanceActive } = require('../config/maintenance');
    expect(isMaintenanceActive()).toBe(true);
  });
});

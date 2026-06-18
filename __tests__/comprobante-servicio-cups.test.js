const { nombreServicioComprobanteCups } = require('../utils/comprobante-servicio-cups');

describe('comprobante-servicio-cups', () => {
  test('epileptología primera vez → otras especialidades médicas con sufijo', () => {
    const out = nombreServicioComprobanteCups('Consulta de Primera Vez por Epileptología');
    expect(out).toBe('Consulta de primera vez por otras especialidades médicas (Epileptología)');
  });

  test('neurología control → nombre CUPS ambulatorio', () => {
    const out = nombreServicioComprobanteCups('Consulta de Control por Neurología');
    expect(out).toMatch(/neurolog[ií]a control/i);
  });

  test('EEG → electroencefalograma convencional', () => {
    const out = nombreServicioComprobanteCups('EEG convencional');
    expect(out).toMatch(/electroencefalograma convencional/i);
  });

  test('nombre de estudio renombrado conserva texto original', () => {
    const out = nombreServicioComprobanteCups('Electroencefalograma Basal Extendido');
    expect(out).toBe('Electroencefalograma Basal Extendido');
  });

  test('desconocido conserva texto original', () => {
    const out = nombreServicioComprobanteCups('Servicio particular custom');
    expect(out).toBe('Servicio particular custom');
  });
});

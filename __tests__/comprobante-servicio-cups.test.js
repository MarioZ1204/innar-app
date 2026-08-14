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

  test('nombres del catálogo de comprobante se conservan (no se les quita el sufijo)', () => {
    const primera = nombreServicioComprobanteCups(
      'Consulta de Primera Vez por Otras Especialidades Médicas (Epileptología)'
    );
    const control = nombreServicioComprobanteCups(
      'Consulta de Control por Otras Especialidades Médicas (Epileptología)'
    );
    expect(primera).toBe('Consulta de Primera Vez por Otras Especialidades Médicas (Epileptología)');
    expect(control).toBe('Consulta de Control por Otras Especialidades Médicas (Epileptología)');
  });

  test('desconocido conserva texto original', () => {
    const out = nombreServicioComprobanteCups('Servicio particular custom');
    expect(out).toBe('Servicio particular custom');
  });
});

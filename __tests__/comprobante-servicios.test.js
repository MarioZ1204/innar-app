const {
  formatFechaComprobante,
  formatFechaNacimiento,
  parseImagenBase64,
  validarPayloadComprobanteServicios,
  buildComprobanteServiciosHtml,
  COMPROBANTE_SERVICIOS_TITULO,
  COMPROBANTE_SERVICIOS_FOMAG_TEXTO,
  COMPROBANTE_SERVICIOS_PIE,
  COMPROBANTE_LAYOUT,
  calcularPosicionesFirma
} = require('../utils/comprobante-servicios');

const FIRMA_MINI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('comprobante-servicios', () => {
  test('posiciones firma: espacio tras sólida, imagen anclada a punteada', () => {
    const F = calcularPosicionesFirma(COMPROBANTE_LAYOUT);
    const L = COMPROBANTE_LAYOUT;
    expect(F.firmaLabelTop).toBeCloseTo(
      L.lineaServicio + L.espacioTrasSolido1 + L.espacioTrasSolido2,
      1
    );
    expect(F.firmaLabelTop - L.lineaServicio).toBeGreaterThanOrEqual(10);
    expect(
      F.firmaImgTop + F.firmaImgHeight + L.margenImagenSobrePunteada
        - (L.firmaImgDesplazamientoAbajo || 0)
    ).toBeCloseTo(L.lineaFirma, 1);
    expect(F.firmaImgWidth).toBe(L.firmaImgAncho);
    expect(F.firmaImgHeight).toBe(L.firmaImgAlturaSlot);
  });

  test('formatea fecha larga en español', () => {
    expect(formatFechaComprobante('2026-06-11')).toBe('11 de junio de 2026');
  });

  test('formatea fecha de nacimiento ISO', () => {
    expect(formatFechaNacimiento('2002-04-12')).toBe('2002-04-12');
  });

  test('parsea imagen base64 data URL', () => {
    const img = parseImagenBase64(FIRMA_MINI);
    expect(img).not.toBeNull();
    expect(img.mime).toBe('image/png');
    expect(img.base64.length).toBeGreaterThan(10);
  });

  test('valida payload mínimo', () => {
    const r = validarPayloadComprobanteServicios({
      fecha: '2026-05-27',
      paciente_nombre: 'MARIO FERNANDO ZAMBRANO MEJIA',
      tipo_documento: 'CC',
      paciente_documento: '1010101893',
      fecha_nacimiento: '2002-04-12',
      direccion: 'CRA 15B JAVERIANO',
      telefono: '3164518932',
      correo: 'mariozamb1204@gmail.com',
      tipo_afiliacion: 'Cotizante',
      servicio: 'Consulta de Control por Neurología',
      firma_paciente: FIRMA_MINI
    });
    expect(r.error).toBeUndefined();
    expect(r.data.tipo_documento).toBe('CC');
  });

  test('requiere firma del paciente', () => {
    const r = validarPayloadComprobanteServicios({
      fecha: '2026-05-27',
      paciente_nombre: 'Test',
      paciente_documento: '123',
      fecha_nacimiento: '2000-01-01',
      direccion: 'Calle 1',
      telefono: '300',
      correo: 'a@b.com',
      tipo_afiliacion: 'Cotizante',
      servicio: 'EEG'
    });
    expect(r.error).toMatch(/firma/i);
  });

  test('conserva el texto libre del servicio sin mapear al catálogo CUPS', () => {
    const servicioManual = 'Monitorización Electroencefalografica por Video y Radio por 8 horas';
    const r = validarPayloadComprobanteServicios({
      fecha: '2026-05-27',
      paciente_nombre: 'Test Paciente',
      paciente_documento: '1234567890',
      fecha_nacimiento: '2000-01-01',
      direccion: 'Calle 1',
      telefono: '3001234567',
      correo: 'test@example.com',
      tipo_afiliacion: 'Cotizante',
      servicio: servicioManual,
      firma_paciente: FIRMA_MINI
    });
    expect(r.error).toBeUndefined();
    expect(r.data.servicio).toBe(servicioManual);
  });

  test('conserva firma de paciente y de acudiente por separado', () => {
    const r = validarPayloadComprobanteServicios({
      fecha: '2026-05-27',
      paciente_nombre: 'Test Paciente',
      paciente_documento: '1234567890',
      fecha_nacimiento: '2000-01-01',
      direccion: 'Calle 1',
      telefono: '3001234567',
      correo: 'test@example.com',
      tipo_afiliacion: 'Cotizante',
      servicio: 'EEG convencional',
      firma_paciente: FIRMA_MINI,
      firma_acudiente: FIRMA_MINI,
      acudiente_nombre: 'Acudiente Test',
      parentesco: 'Madre'
    });
    expect(r.error).toBeUndefined();
    expect(r.data.firma_paciente).toBeTruthy();
    expect(r.data.firma_acudiente).toBeTruthy();
    const html = buildComprobanteServiciosHtml(r.data);
    expect(html).toContain('alt="Firma del paciente"');
    expect(html).toContain('alt="Firma acudiente"');
    expect(html).toContain('cmp-firma-acud-img');
  });

  test('HTML incluye datos, servicio, firma y pie FORM-24', () => {
    const { data } = validarPayloadComprobanteServicios({
      fecha: '2026-05-27',
      paciente_nombre: 'MARIO FERNANDO ZAMBRANO MEJIA',
      paciente_documento: '1010101893',
      fecha_nacimiento: '2002-04-12',
      direccion: 'CRA 15B JAVERIANO',
      telefono: '3164518932',
      correo: 'mariozamb1204@gmail.com',
      tipo_afiliacion: 'Cotizante',
      servicio: 'Consulta de Control por Neurología',
      firma_paciente: FIRMA_MINI
    });
    const html = buildComprobanteServiciosHtml(data);
    expect(html).toContain(COMPROBANTE_SERVICIOS_TITULO);
    expect(html).toContain(COMPROBANTE_SERVICIOS_FOMAG_TEXTO);
    expect(html).toContain('MARIO FERNANDO ZAMBRANO MEJIA');
    expect(html).toContain('Consulta de Control por Neurología');
    expect(html).toContain('cmp-firma-paciente');
    expect(html).toContain('FIRMA DEL PACIENTE:');
    expect(html).toContain('cmp-acudiente');
    expect(html).toContain('cmp-pie-bloque');
    expect(html).toContain('Auditor Médico');
    expect(html).toContain('Arial');
    expect(html).toMatch(/neurolog/i);
    expect(html).toContain(COMPROBANTE_SERVICIOS_PIE.codigo);
    expect(html).toContain('cmp-pie-col');
    expect(html).not.toContain('cmp-pie-tabla');
    expect(html).toContain(COMPROBANTE_SERVICIOS_PIE.version);
    expect(html).toContain(COMPROBANTE_SERVICIOS_PIE.fecha_actualizacion);
    expect(html).toContain('Arial');
  });
});

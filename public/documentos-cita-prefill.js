/** Helpers compartidos para prellenar certificado/comprobante desde citas */
(function (root) {
  'use strict';

  const CERT_ASIST_LS_KEY = 'innar.certAsistencia.defaults';

  function extraerFechaYmd(valor) {
    if (!valor) return '';
    const s = String(valor).trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) return m[1];
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return '';
  }

  function horaDesdeCita(horaRaw) {
    const s = String(horaRaw || '').trim();
    if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
    return s || '';
  }

  function leerDefaultsCertificado() {
    try {
      const raw = localStorage.getItem(CERT_ASIST_LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function fechaFinElectro(cita) {
    const finRaw = cita?.hora_fin_date || cita?.hora_fin;
    if (finRaw) {
      const d = new Date(finRaw);
      if (!isNaN(d.getTime())) {
        return {
          fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        };
      }
    }
    return {
      fecha: extraerFechaYmd(cita?.hora_fin_date || cita?.fecha),
      hora: horaDesdeCita(cita?.hora_fin || cita?.hora_agendamiento)
    };
  }

  function prefillCertificadoElectro(cita, usuario) {
    const fechaIng = extraerFechaYmd(cita?.fecha);
    const horaIng = horaDesdeCita(cita?.hora_inicio || cita?.hora_agendamiento);
    const fin = fechaFinElectro(cita);
    const defaults = leerDefaultsCertificado();
    const nombreUsuario = (usuario?.nombre || usuario?.usuario || '').trim();
    return {
      origen: 'electro',
      paciente_nombre: (cita?.paciente_nombre || '').trim(),
      paciente_documento: (cita?.paciente_documento || '').trim(),
      tipo_documento: 'CC',
      motivo: (cita?.estudio || '').trim(),
      fecha_ingreso: fechaIng,
      hora_ingreso: horaIng,
      fecha_egreso: fin.fecha || fechaIng,
      hora_egreso: fin.hora || horaIng,
      funcionario_nombre: defaults.funcionario_nombre || nombreUsuario,
      funcionario_cargo: defaults.funcionario_cargo || ''
    };
  }

  function prefillCertificadoMedica(turno, usuario) {
    const fecha = extraerFechaYmd(turno?.fecha);
    const hora = horaDesdeCita(turno?.hora);
    const defaults = leerDefaultsCertificado();
    const nombreUsuario = (usuario?.nombre || usuario?.usuario || '').trim();
    return {
      origen: 'medica',
      paciente_nombre: (turno?.paciente_nombre || '').trim(),
      paciente_documento: (turno?.paciente_documento || '').trim(),
      tipo_documento: 'CC',
      motivo: (turno?.tipo_consulta || '').trim(),
      fecha_ingreso: fecha,
      hora_ingreso: hora,
      fecha_egreso: fecha,
      hora_egreso: hora,
      funcionario_nombre: defaults.funcionario_nombre || nombreUsuario,
      funcionario_cargo: defaults.funcionario_cargo || ''
    };
  }

  function prefillComprobanteElectro(cita) {
    return {
      origen: 'electro',
      paciente_nombre: (cita?.paciente_nombre || '').trim(),
      paciente_documento: (cita?.paciente_documento || '').trim(),
      tipo_documento: 'CC',
      fecha: extraerFechaYmd(cita?.fecha),
      fecha_nacimiento: '',
      direccion: '',
      telefono: (cita?.telefono || '').trim(),
      correo: '',
      tipo_afiliacion: 'Cotizante',
      servicio: (cita?.estudio || '').trim()
    };
  }

  function prefillComprobanteMedica(turno) {
    return {
      origen: 'medica',
      paciente_nombre: (turno?.paciente_nombre || '').trim(),
      paciente_documento: (turno?.paciente_documento || '').trim(),
      tipo_documento: 'CC',
      fecha: extraerFechaYmd(turno?.fecha),
      fecha_nacimiento: '',
      direccion: '',
      telefono: (turno?.paciente_telefono || '').trim(),
      correo: '',
      tipo_afiliacion: (turno?.entidad || '').trim() || 'Cotizante',
      servicio: (turno?.tipo_consulta || '').trim()
    };
  }

  function prefillDesdeCita(tipoDoc, origen, cita, usuario) {
    if (tipoDoc === 'certificado') {
      return origen === 'electro'
        ? prefillCertificadoElectro(cita, usuario)
        : prefillCertificadoMedica(cita, usuario);
    }
    return origen === 'electro'
      ? prefillComprobanteElectro(cita)
      : prefillComprobanteMedica(cita);
  }

  root.innarDocPrefill = {
    extraerFechaYmd,
    prefillDesdeCita,
    leerDefaultsCertificado
  };
})(typeof window !== 'undefined' ? window : globalThis);

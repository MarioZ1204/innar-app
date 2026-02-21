// disponibilidad-mensual.js
// Manejo de disponibilidad mensual en la agenda médica

let disponibilidadPorDoctor = {}; // Cache: { doctorId: [{ fecha, pacientes_proinsalud, ... }] }
let notificationShown = {}; // Rastrear notificaciones mostradas por fecha para evitar duplicados

/**
 * Obtiene la disponibilidad mensual de un doctor desde el servidor
 */
async function cargarDisponibilidad(doctorId, mes = null) {
  if (!doctorId) return [];
  
  try {
    let url = `/api/doctor-disponibilidad/${doctorId}`;
    if (mes) {
      url += `?mes=${mes}`;
    }
    
    const response = await apiFetch(url);
    const data = await response.json();
    
    if (data.ok) {
      disponibilidadPorDoctor[doctorId] = data.disponibilidad || [];
      return data.disponibilidad;
    }
    return [];
  } catch (error) {
    console.error('Error cargando disponibilidad:', error);
    return [];
  }
}

/**
 * Valida si un doctor tiene disponibilidad en una fecha específica
 * Retorna { disponible: boolean, totalPacientes: number }
 */
async function validarDisponibilidadFecha(doctorId, fecha) {
  if (!doctorId || !fecha) return { disponible: true, totalPacientes: null };

  try {
    const response = await apiFetch('/api/doctor-disponibilidad/validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctor_id: doctorId,
        fecha: typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0]
      })
    });

    const data = await response.json();
    return {
      disponible: data.disponible || false,
      totalPacientes: data.totalPacientes,
      mensaje: data.mensaje
    };
  } catch (error) {
    console.error('Error validando disponibilidad:', error);
    return { disponible: true, totalPacientes: null };
  }
}

/**
 * Muestra un mensaje de notificación cuando no hay disponibilidad (SOLO UNA VEZ)
 */
function mostrarNotificacionSinDisponibilidad(fecha) {
  // Evitar mostrar la notificación múltiples veces por la misma fecha
  if (notificationShown[fecha]) {
    return;
  }
  notificationShown[fecha] = true;

  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #fee;
    color: #c00;
    padding: 16px 20px;
    border-radius: 8px;
    border-left: 4px solid #c00;
    font-weight: 500;
    max-width: 400px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  
  notification.innerHTML = `
    <strong>⚠️ No disponible</strong><br>
    PARA ESTE DÍA NO PUEDES AGENDAR, EL DOCTOR NO CUENTA CON DISPONIBILIDAD
  `;

  if (!document.querySelector('style[data-disponibilidad]')) {
    const style = document.createElement('style');
    style.setAttribute('data-disponibilidad', 'true');
    style.innerHTML = `
      @keyframes slideIn {
        from {
          transform: translateX(420px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(420px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => {
      notification.remove();
      // Limpiar el flag después de que desaparezca
      delete notificationShown[fecha];
    }, 300);
  }, 4000);
}

/**
 * Deshabilita los campos de entrada cuando la fecha no tiene disponibilidad
 */
function deshabilitarCamposPaciente(disabled) {
  const campos = [
    'nuevoPacienteNombreMedica',
    'nuevoPacienteDocMedica',
    'nuevoPacienteTelefonoMedica',
    'nuevoTurnoHoraMedica',
    'nuevoTurnoEntidadMedica',
    'nuevoTurnoTipoMedica',
    'nuevoTurnoNotasMedica',
    'nuevoTurnoOportunidadMedica',
    'crearTurnoMedica'
  ];
  
  campos.forEach(id => {
    const elemento = $(id);
    if (elemento) {
      elemento.disabled = disabled;
      if (disabled) {
        elemento.style.opacity = '0.5';
        elemento.style.cursor = 'not-allowed';
        elemento.style.backgroundColor = '#f5f5f5';
      } else {
        elemento.style.opacity = '1';
        elemento.style.cursor = 'auto';
        elemento.style.backgroundColor = '';
      }
    }
  });
}

/**
 * Valida el datepicker al seleccionar una fecha - VALIDACIÓN INMEDIATA
 */
function deshabilitarFechasNoDisponibles(inputElement, doctorId) {
  if (!inputElement) return;

  // Validar inmediatamente cuando cambia la fecha
  const validarFecha = async (fechaValue) => {
    if (!fechaValue) {
      inputElement.style.borderColor = '';
      inputElement.style.backgroundColor = '';
      deshabilitarCamposPaciente(false);
      return true;
    }

    const resultado = await validarDisponibilidadFecha(doctorId, fechaValue);

    if (!resultado.disponible) {
      // Mostrar notificación SOLO una vez
      mostrarNotificacionSinDisponibilidad(fechaValue);
      // Marcar el campo como no disponible
      inputElement.style.borderColor = '#c00';
      inputElement.style.backgroundColor = '#fff5f5';
      // DESHABILITAR TODOS LOS CAMPOS DE PACIENTE
      deshabilitarCamposPaciente(true);
      return false;
    } else {
      // Campo válido - restablecer estilos y habilitar campos
      inputElement.style.borderColor = '';
      inputElement.style.backgroundColor = '';
      deshabilitarCamposPaciente(false);
      return true;
    }
  };

  // Validar solo en 'change' para evitar múltiples validaciones
  inputElement.addEventListener('change', async (e) => {
    await validarFecha(e.target.value);
  });

  // Validar cuando pierden el foco
  inputElement.addEventListener('blur', async (e) => {
    await validarFecha(e.target.value);
  });
}

/**
 * Actualiza el cache de disponibilidad cuando se recibe actualización por WebSocket
 */
function actualizarDisponibilidad(doctorId) {
  if (doctorId) {
    cargarDisponibilidad(doctorId);
  }
}

/**
 * Procesa un archivo Excel de disponibilidad mensual
 */
async function procesarExcelDisponibilidad(file, doctorId) {
  if (!file || !doctorId) {
    alert('Se requiere archivo y doctor ID');
    return false;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('doctor_id', doctorId);

  try {
    const response = await apiFetch('/api/doctor-disponibilidad/procesar-excel', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.ok) {
      const mensaje = `✓ ${data.diasGuardados} días de disponibilidad guardados correctamente`;
      mostrarAlerta(mensaje, 'success');
      
      if (data.errores && data.errores.length > 0) {
        console.warn('Advertencias:', data.errores);
      }
      
      await cargarDisponibilidad(doctorId);
      return true;
    } else {
      mostrarAlerta(`Error: ${data.error}`, 'error');
      return false;
    }
  } catch (error) {
    console.error('Error procesando Excel:', error);
    mostrarAlerta('Error al procesar el archivo', 'error');
    return false;
  }
}

/**
 * Muestra una alerta
 */
function mostrarAlerta(mensaje, tipo = 'info') {
  if (typeof showNotification === 'function') {
    showNotification(mensaje, tipo);
    return;
  }
  alert(mensaje);
}

/**
 * Crea un datepicker que valida automáticamente la disponibilidad
 */
function crearDatepickerConDisponibilidad(inputElement, doctorId, onFechaSeleccionada = null) {
  deshabilitarFechasNoDisponibles(inputElement, doctorId);
  cargarDisponibilidad(doctorId);

  if (onFechaSeleccionada && typeof onFechaSeleccionada === 'function') {
    inputElement.addEventListener('change', async (e) => {
      if (e.target.value) {
        const resultado = await validarDisponibilidadFecha(doctorId, e.target.value);
        if (resultado.disponible) {
          onFechaSeleccionada(e.target.value);
        }
      }
    });
  }
}

/**
 * Obtiene información de disponibilidad para mostrar en el UI
 * Retorna: { pacientes_proinsalud, pacientes_otros, total_pacientes, disponible }
 */
async function obtenerInfoDisponibilidadFecha(doctorId, fecha) {
  const disp = disponibilidadPorDoctor[doctorId] || [];
  const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];
  
  return disp.find(d => d.fecha === fechaFormato) || {
    pacientes_proinsalud: 0,
    pacientes_otros: 0,
    total_pacientes: 0,
    disponible: true
  };
}

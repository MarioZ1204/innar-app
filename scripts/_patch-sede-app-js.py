from pathlib import Path

p = Path(__file__).resolve().parents[1] / "public" / "app.js"
text = p.read_text(encoding="utf-8")
start = text.index("function _asegurarModalSedeRecordatorio()")
end = text.index("function enviarRecordatorioWhatsAppMedica(turno)")
replacement = """function cerrarModalSedeRecordatorio() {
  const modal = document.getElementById('modalSedeRecordatorio');
  if (modal) modal.classList.add('hidden');
}

function mostrarModalSedeRecordatorio(turno) {
  const telefono = String(turno?.paciente_telefono || '').replace(/\\D/g, '');
  if (!telefono || telefono.length < 7) {
    showToast('La cita no tiene un teléfono válido para enviar recordatorio', 'error');
    return;
  }
  const modal = document.getElementById('modalSedeRecordatorio');
  if (!modal) {
    showToast('No se pudo abrir el selector de sede', 'error');
    return;
  }

  const enviar = (sedeId) => {
    const especialidadActual = selectedDoctorEspecialidad || currentUser?.especialidad || '';
    const mensaje = construirMensajeRecordatorioMedica(turno, especialidadActual, sedeId);
    const numero = telefono.startsWith('57') ? telefono : `57${telefono}`;
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank');
    showToast('Recordatorio listo para enviar por WhatsApp', 'success');
    cerrarModalSedeRecordatorio();
  };

  const btn1 = document.getElementById('sedeRBtn1');
  const btn2 = document.getElementById('sedeRBtn2');
  const btnCancel = document.getElementById('sedeRBtnCancel');
  if (btn1) btn1.onclick = () => enviar('1');
  if (btn2) btn2.onclick = () => enviar('2');
  if (btnCancel) btnCancel.onclick = cerrarModalSedeRecordatorio;

  if (!modal.dataset.sedeOverlayBound) {
    modal.dataset.sedeOverlayBound = '1';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModalSedeRecordatorio();
    });
    const dialog = modal.querySelector('.sede-recordatorio-dialog');
    if (dialog) dialog.addEventListener('click', (e) => e.stopPropagation());
  }

  modal.classList.remove('hidden');
}

"""
text = text[:start] + replacement + text[end:]
p.write_text(text, encoding="utf-8")
print("patched app.js")

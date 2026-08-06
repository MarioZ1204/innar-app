'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const db = require('../utils/db-mysql');
const logger = require('../utils/logger');
const { getPuppeteerLaunchOptions, getLogoBase64 } = require('../utils/puppeteer-utils');
const { readFileBuffer, pathExists } = require('../utils/fs-async');
const {
  requireAuth, requireRoleOrPerm,
  safeError, isAdminRol, isRecepcionRol
} = require('../middleware/index');
const { queryCitasAuditoria, enriquecerCitasConRecibos, adjuntarRecibosResumenACitas, citasSinRecibosResumen, opcionesCargaRecibosDesdeQuery } = require('../utils/citas-auditoria');

const jsonLargeBody = require('express').json({ limit: '50mb' });

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// GET /api/reportes/diario
router.get('/reportes/diario', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'contabilidad'], 'recibos.ver'), async (req, res) => {
  try {
    const fecha = req.query.fecha;
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const recibos = await db.query('SELECT * FROM recibos WHERE fecha=? ORDER BY id DESC', [fecha]);
    const total = recibos.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    const recibosConDoc = recibos.map(r => {
      let doc = '-';
      let servicios = '-';
      let fechaFormato = '-';

      if (r.fecha) {
        let fechaStr = typeof r.fecha === 'string' ? r.fecha : String(r.fecha);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
          fechaFormato = fechaStr;
        } else {
          try {
            const d = new Date(fechaStr);
            if (!isNaN(d.getTime())) {
              fechaFormato = d.toISOString().split('T')[0];
            }
          } catch (e) { /* ignorar */ }
        }
      }

      try {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (d && d.doc != null) doc = String(d.doc);
        if (d && d.items && Array.isArray(d.items)) {
          servicios = d.items.map(item => item.desc || '').filter(s => s).join(', ') || '-';
        }
      } catch (e) { /* ignorar */ }
      return { ...r, doc, servicios, fechaFormato };
    });

    const logoBase64Data = getLogoBase64();

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Reporte Diario</title>
        <style>
          body { font-family:Arial; margin:18px; color:#000; position:relative; padding:0; }
          .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-45deg); font-size:120px; opacity:0.1; z-index:0; width:200%; height:200%; pointer-events:none; }
          .content { position:relative; z-index:1; }
          h1 { text-align:center; color:#8AA6A1; font-size:16px; margin:8px 0; }
          .logo-corner { position:absolute; top:0; right:0; width:70px; height:70px; object-fit:contain; object-position:top right; display:block; z-index:2; }
          table { width:100%; border-collapse:collapse; margin:12px 0; font-size:10px; }
          th, td { border:1px solid #ddd; padding:4px 6px; text-align:left; font-size:10px; }
          th { background-color:#f0f0f0; font-weight:bold; }
          .total { font-weight:bold; font-size:14px; }
          .summary { background-color:#f9f9f9; padding:12px; margin:12px 0; border-left:4px solid #8AA6A1; }
          .summary p { margin:4px 0; font-size:12px; }
        </style>
      </head>
      <body>
        <img src="data:image/png;base64,${logoBase64Data}" class="logo-corner" alt="Logo" />
        <div class="watermark">
          <img src="data:image/png;base64,${logoBase64Data}" style="width:100%;opacity:0.15;" />
        </div>
        <div class="content">
          <h1>Reporte Diario</h1>
          <div class="summary">
            <p><strong>Fecha:</strong> ${fecha.includes('-') ? fecha : new Date(fecha).toISOString().split('T')[0]}</p>
            <p><strong>Total de recibos:</strong> ${recibos.length}</p>
            <p class="total"><strong>Total dinero:</strong> $ ${total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Recibo Nº</th>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Servicios</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recibosConDoc.map(r => {
                return `<tr>
                  <td>${escapeHtml(r.numero)}</td>
                  <td>${escapeHtml(r.doc)}</td>
                  <td>${escapeHtml(r.cliente)}</td>
                  <td>${escapeHtml(r.servicios)}</td>
                  <td>$ ${Number(r.total).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    let browser = null;
    try {
      const launchOptions = getPuppeteerLaunchOptions();
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '10px', bottom: '10px', left: '10px', right: '10px' }
      });
      await browser.close();

      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=reporte_diario_${fecha}.pdf`);
      res.send(pdf);
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      logger.error('Error en PDF:', e.message);
      res.status(500).json({ error: safeError(e, 'Error generando PDF: ') + '. Intenta instalar Google Chrome.' });
    }
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e, 'Error generando reporte: ') });
  }
});

// GET /api/reportes/mensual
router.get('/reportes/mensual', requireAuth, requireRoleOrPerm(['superadmin', 'admin', 'admin_recepcion', 'contabilidad'], 'recibos.ver'), async (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes) return res.status(400).json({ error: 'Mes requerido' });

    const fechaInicio = mes + '-01';
    const proximoMes = new Date(mes + '-01');
    proximoMes.setMonth(proximoMes.getMonth() + 1);
    const fechaFin = proximoMes.toISOString().slice(0, 10);

    const recibos = await db.query('SELECT * FROM recibos WHERE fecha >= ? AND fecha < ? ORDER BY fecha DESC', [fechaInicio, fechaFin]);
    const total = recibos.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    const recibosConDoc = recibos.map(r => {
      let doc = '-';
      let servicios = '-';
      let fechaFormato = '-';

      if (r.fecha) {
        let fechaStr = typeof r.fecha === 'string' ? r.fecha : String(r.fecha);
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
          fechaFormato = fechaStr;
        } else {
          try {
            const d = new Date(fechaStr);
            if (!isNaN(d.getTime())) {
              fechaFormato = d.toISOString().split('T')[0];
            }
          } catch (e) { /* ignorar */ }
        }
      }

      try {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        if (d && d.doc != null) doc = String(d.doc);
        if (d && d.items && Array.isArray(d.items)) {
          servicios = d.items.map(item => item.desc || '').filter(s => s).join(', ') || '-';
        }
      } catch (e) { /* ignorar */ }
      return { ...r, doc, servicios, fechaFormato };
    });

    const logoBase64Data = getLogoBase64();

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          body { font-family:Arial; margin:18px; color:#000; position:relative; padding:0; }
          .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-45deg); font-size:120px; opacity:0.1; z-index:0; width:200%; height:200%; pointer-events:none; }
          .content { position:relative; z-index:1; }
          h1 { text-align:center; color:#8AA6A1; font-size:16px; margin:8px 0; }
          .logo-corner { position:absolute; top:0; right:0; width:70px; height:70px; object-fit:contain; object-position:top right; display:block; z-index:2; }
          table { width:100%; border-collapse:collapse; margin:12px 0; font-size:10px; }
          th, td { border:1px solid #ddd; padding:4px 6px; text-align:left; font-size:10px; }
          th { background-color:#f0f0f0; font-weight:bold; }
          .total { font-weight:bold; font-size:14px; }
          .summary { background-color:#f9f9f9; padding:12px; margin:12px 0; border-left:4px solid #8AA6A1; }
          .summary p { margin:4px 0; font-size:12px; }
        </style>
      </head>
      <body>
        <img src="data:image/png;base64,${logoBase64Data}" class="logo-corner" alt="Logo" />
        <div class="watermark">
          <img src="data:image/png;base64,${logoBase64Data}" style="width:100%;opacity:0.15;" />
        </div>
        <div class="content">
          <h1>Reporte Mensual</h1>
          <div class="summary">
            <p><strong>Mes:</strong> ${mes}</p>
            <p><strong>Total de recibos:</strong> ${recibos.length}</p>
            <p class="total"><strong>Total dinero:</strong> $ ${total.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</p>
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Recibo Nº</th>
                <th>Documento</th>
                <th>Cliente</th>
                <th>Servicios</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${recibosConDoc.map(r => {
                return `<tr>
                  <td>${escapeHtml(r.fechaFormato)}</td>
                  <td>${escapeHtml(r.numero)}</td>
                  <td>${escapeHtml(r.doc)}</td>
                  <td>${escapeHtml(r.cliente)}</td>
                  <td>${escapeHtml(r.servicios)}</td>
                  <td>$ ${Number(r.total).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    let browser = null;
    try {
      const launchOptions = getPuppeteerLaunchOptions();
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '18px', bottom: '18px', left: '18px', right: '18px' }
      });
      await browser.close();

      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=reporte_mensual_${mes}.pdf`);
      res.send(pdf);
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      logger.error('Error en PDF:', e.message);
      res.status(500).json({ error: 'Error generando PDF. Verifica que Puppeteer esté instalado.' });
    }
  } catch (e) {
    logger.error(e.message, { error: e });
    res.status(500).json({ error: safeError(e, 'Error generando reporte: ') });
  }
});

const DASHBOARD_CITAS_PERM = requireRoleOrPerm(
  ['superadmin', 'admin', 'admin_recepcion', 'recepcion', 'admin_electro', 'electro', 'doctor', 'contabilidad'],
  'sistema.dashboard'
);

// GET /api/dashboard/citas-auditoria
router.get('/dashboard/citas-auditoria', requireAuth, DASHBOARD_CITAS_PERM, async (req, res) => {
  try {
    const { citas, resumen, citasMedicas, citasElectro } = await queryCitasAuditoria(db, req.query);
    const sinRecibos = req.query.sin_recibos === '1' || req.query.sin_recibos === 'true';
    const opcionesRecibos = opcionesCargaRecibosDesdeQuery(req.query);
    const data = sinRecibos
      ? citasSinRecibosResumen(citas)
      : await adjuntarRecibosResumenACitas(db, citas, opcionesRecibos);

    logger.info('Dashboard auditoría citas', {
      usuario: req.session && req.session.usuario ? req.session.usuario : 'Unknown',
      total_citas: citas.length,
      medicas: citasMedicas.length,
      electro: citasElectro.length,
      sin_recibos: sinRecibos
    });

    res.json({ success: true, data, resumen, recibos_pendientes: sinRecibos });
  } catch (e) {
    logger.error('Error en dashboard auditoría', { error: e.message, stack: e.stack });
    res.status(500).json({ error: safeError(e, 'Error al cargar auditoría de citas: ') });
  }
});

// GET /api/dashboard/citas-auditoria/export — mismos filtros + datos de recibo (solo reportes)
router.get('/dashboard/citas-auditoria/export', requireAuth, DASHBOARD_CITAS_PERM, async (req, res) => {
  try {
    const { citas } = await queryCitasAuditoria(db, req.query);
    const opcionesRecibos = opcionesCargaRecibosDesdeQuery(req.query);
    const data = await enriquecerCitasConRecibos(db, citas, opcionesRecibos);

    logger.info('Dashboard auditoría citas export', {
      usuario: req.session?.usuario || 'Unknown',
      total_citas: data.length,
      con_recibo: data.filter((c) => c.recibo_numero).length
    });

    res.json({ success: true, data });
  } catch (e) {
    logger.error('Error exportando auditoría citas', { error: e.message, stack: e.stack });
    res.status(500).json({ error: safeError(e, 'Error al exportar auditoría de citas: ') });
  }
});

// POST /api/agenda/pdf
router.post('/agenda/pdf', requireAuth, jsonLargeBody, async (req, res) => {
  try {
    const { doctor_id, fecha_inicio, fecha_fin } = req.body;
    const userId = req.session.usuarioId;
    const userRol = req.session.rol;

    if (!isRecepcionRol(userRol) && !isAdminRol(userRol)) {
      if (userId !== parseInt(doctor_id)) {
        return res.status(403).json({ error: 'No tienes permiso para ver esta agenda' });
      }
    }

    const doctorData = await db.query(
      'SELECT nombre, usuario, numero_consultorio FROM usuarios WHERE id = ?',
      [doctor_id]
    );

    if (!doctorData || !doctorData.length) {
      return res.status(404).json({ error: 'Doctor no encontrado' });
    }

    const doctor = doctorData[0];
    const nombredoctor = doctor.nombre || doctor.usuario;
    const consultorio = doctor.numero_consultorio || 'N/A';

    let desde = fecha_inicio;
    let hasta = fecha_fin;

    if (!desde || !hasta) {
      const hoy = new Date();
      desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
      hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    const citas = await db.query(`
      SELECT
        t.fecha,
        t.hora,
        t.paciente_nombre,
        t.paciente_documento,
        t.paciente_telefono,
        t.tipo_consulta,
        t.estado,
        t.numero_turno
      FROM turnos t
      WHERE t.doctor_id = ? AND t.fecha BETWEEN ? AND ? AND t.estado NOT IN ('CANCELADO', 'COMPLETADO')
      ORDER BY t.fecha ASC, t.hora ASC
    `, [doctor_id, desde, hasta]);

    const citasPorFecha = {};
    citas.forEach(cita => {
      if (!citasPorFecha[cita.fecha]) {
        citasPorFecha[cita.fecha] = [];
      }
      citasPorFecha[cita.fecha].push(cita);
    });

    const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo1.png');
    let logoBase64Data = '';
    if (await pathExists(logoPath)) {
      const logoBuffer = await readFileBuffer(logoPath);
      logoBase64Data = logoBuffer.toString('base64');
    }

    const fechaDesdeFormato = new Date(desde).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    const fechaHastaFormato = new Date(hasta).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Agenda - ${nombredoctor}</title>
        <style>
          body { font-family:Arial; margin:18px; color:#000; position:relative; padding:0; }
          .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) rotate(-45deg); font-size:100px; opacity:0.08; z-index:0; width:200%; height:200%; pointer-events:none; }
          .content { position:relative; z-index:1; }
          .header { text-align:center; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid #8AA6A1; }
          .logo-corner { width:120px; height:120px; object-fit:contain; display:block; margin:0 auto 12px auto; }
          .doctor-info { background-color:#f0f9ff; padding:12px; border-left:4px solid #8AA6A1; margin-bottom:16px; border-radius:4px; }
          .doctor-info p { margin:4px 0; font-size:11px; }
          .fecha-section { margin-bottom:20px; page-break-inside:avoid; }
          .fecha-titulo { background-color:#8AA6A1; color:white; padding:8px 12px; font-weight:bold; margin-bottom:8px; border-radius:4px; }
          table { width:100%; border-collapse:collapse; margin-bottom:16px; font-size:9px; }
          th { background-color:#e0e7e6; border:1px solid #bbb; padding:6px 4px; text-align:left; font-weight:bold; }
          td { border:1px solid #ddd; padding:4px 6px; text-align:left; }
          .footer { text-align:center; margin-top:24px; padding-top:12px; border-top:1px solid #ddd; font-size:9px; color:#666; }
          .no-data { text-align:center; padding:20px; color:#999; font-style:italic; }
        </style>
      </head>
      <body>
        <div class="watermark">AGENDA</div>
        <div class="content">
          <div class="header">
            ${logoBase64Data ? `<img src="data:image/png;base64,${logoBase64Data}" class="logo-corner" alt="Logo" />` : ''}
            <h1 style="margin:0 0 6px 0; color:#8AA6A1; font-size:14px">AGENDA DE PACIENTES</h1>
            <p style="margin:0; font-size:11px; color:#666">${nombredoctor}</p>
          </div>
          <div class="doctor-info">
            <p><strong>Doctor:</strong> ${escapeHtml(nombredoctor)}</p>
            <p><strong>Consultorio:</strong> ${escapeHtml(consultorio)}</p>
            <p><strong>Período:</strong> ${fechaDesdeFormato} al ${fechaHastaFormato}</p>
            <p><strong>Total de citas:</strong> ${citas.length}</p>
          </div>
          ${Object.keys(citasPorFecha).length > 0 ? Object.entries(citasPorFecha).map(([fecha, citasDelDia]) => {
            const fechaObj = new Date(fecha);
            const fechaFormato = fechaObj.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            return `
              <div class="fecha-section">
                <div class="fecha-titulo">${fechaFormato.charAt(0).toUpperCase() + fechaFormato.slice(1)} (${citasDelDia.length} pacientes)</div>
                <table>
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Nº Turno</th>
                      <th>Paciente</th>
                      <th>Documento</th>
                      <th>Teléfono</th>
                      <th>Tipo Consulta</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${citasDelDia.map(c => {
                      return `
                        <tr>
                          <td>${c.hora ? c.hora.substring(0, 5) : '-'}</td>
                          <td>${c.numero_turno || '-'}</td>
                          <td>${escapeHtml(c.paciente_nombre || '-')}</td>
                          <td>${escapeHtml(c.paciente_documento || '-')}</td>
                          <td>${escapeHtml(c.paciente_telefono || '-')}</td>
                          <td>${escapeHtml(c.tipo_consulta || '-')}</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }).join('')
          : `<div class="no-data">No hay citas registradas para este período</div>`}
          <div class="footer">
            <p>Generado: ${new Date().toLocaleDateString('es-ES')} - Instituto Neurociencias de Nariño S.A.S.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    let browser = null;
    try {
      const launchOptions = getPuppeteerLaunchOptions();
      browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '12px', bottom: '12px', left: '12px', right: '12px' }
      });
      await browser.close();

      logger.info('PDF Agenda generado', {
        doctor_id: doctor_id,
        total_citas: citas.length,
        usuario: req.session.usuario
      });

      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=agenda_${nombredoctor.replace(/\s+/g, '_')}_${desde}.pdf`);
      res.send(pdf);
    } catch (e) {
      if (browser) await browser.close().catch(() => {});
      logger.error('Error generando PDF agenda', { error: safeError(e) });
      res.status(500).json({ error: safeError(e, 'Error generando PDF: ') });
    }
  } catch (e) {
    logger.error('Error en endpoint agenda PDF', { error: e.message, stack: e.stack });
    res.status(500).json({ error: safeError(e, 'Error: ') });
  }
});

module.exports = router;

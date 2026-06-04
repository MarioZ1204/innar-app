/**
 * Clasificación PSG / EEG / VTM (browser) — mantener alineado con utils/electro-estudio-tipo.js
 */
(function (root) {
  function normEstudioNombre(estudio) {
    return String(estudio || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function esEstudioElectroVtm(estudio) {
    const u = normEstudioNombre(estudio);
    if (!u) return false;
    if (/\bvtm\b/.test(u)) return true;
    if (u.includes('videotelemetria') || u.includes('video telemetria')) return true;
    if (u.includes('monitoriz') && u.includes('video') && (u.includes('radio') || u.includes('rabio'))) {
      return true;
    }
    return false;
  }

  function esEstudioElectroPsg(estudio) {
    const u = normEstudioNombre(estudio);
    if (!u) return false;
    if (
      u.includes('polisomnog') ||
      /^psg\b/.test(u) ||
      u.startsWith('psg ') ||
      (u.includes('basica') && (u.includes('psg') || u.includes('polisom'))) ||
      (u.includes('titulacion') &&
        (u.includes('cpap') || u.includes('bpap') || u.includes('psg') || u.includes('polisom') ||
          u.includes('sueno')))
    ) {
      return true;
    }
    return false;
  }

  function esEstudioElectroEeg(estudio) {
    if (esEstudioElectroVtm(estudio)) return false;
    const u = normEstudioNombre(estudio);
    if (!u) return false;
    if (u.includes('electroencefalog')) return true;
    if (/\beeg\b/.test(u)) return true;
    return false;
  }

  function tipoEstudioElectro(estudio) {
    if (esEstudioElectroPsg(estudio)) return 'psg';
    if (esEstudioElectroVtm(estudio)) return 'vtm';
    if (esEstudioElectroEeg(estudio)) return 'eeg';
    const u = normEstudioNombre(estudio);
    if (u.includes('actigraf')) return 'actigrafia';
    return 'otro';
  }

  root.innarElectroEstudioTipo = {
    normEstudioNombre,
    esEstudioElectroVtm,
    esEstudioElectroPsg,
    esEstudioElectroEeg,
    tipoEstudioElectro
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

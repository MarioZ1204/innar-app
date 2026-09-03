'use strict';

const { parseDoctorIdsJson } = require('../utils/llamado-tv-config');

describe('llamado-tv-config', () => {
  test('parseDoctorIdsJson acepta array, string JSON y filtra inválidos', () => {
    expect(parseDoctorIdsJson([1, '2', 0, -3, 'x'])).toEqual([1, 2]);
    expect(parseDoctorIdsJson('[3,4]')).toEqual([3, 4]);
    expect(parseDoctorIdsJson(null)).toEqual([]);
  });
});

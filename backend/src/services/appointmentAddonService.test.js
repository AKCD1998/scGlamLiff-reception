import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAppointmentAddonDeductMask,
  resolveRequestedAppointmentAddonCode,
} from './appointmentAddonService.js';

test('legacy used_mask resolves to included mask addon', () => {
  const addonCode = resolveRequestedAppointmentAddonCode({
    appointmentAddonCode: '',
    usedMask: true,
    deductMask: null,
  });

  assert.equal(addonCode, 'COURSE_INCLUDED_MASK');
  assert.equal(getAppointmentAddonDeductMask(addonCode), 1);
});

test('explicit paid addon keeps deduct mask at zero', () => {
  const addonCode = resolveRequestedAppointmentAddonCode({
    appointmentAddonCode: 'GLAM_EXCLUSIVE_MASK_250',
    usedMask: false,
    deductMask: 0,
  });

  assert.equal(addonCode, 'GLAM_EXCLUSIVE_MASK_250');
  assert.equal(getAppointmentAddonDeductMask(addonCode), 0);
});

test('explicit paid addon rejects used_mask compatibility mismatch', async () => {
  assert.throws(
    () =>
      resolveRequestedAppointmentAddonCode({
        appointmentAddonCode: 'GLAM_EXCLUSIVE_MASK_250',
        usedMask: true,
        deductMask: 1,
      }),
    /Paid appointment_addon_code cannot be combined/
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePackageRemaining,
  deriveContinuousPackageStatus,
  shouldShortCircuitCompletedAppointment,
} from './packageContinuity.js';

test('should not deduct again when appointment already completed', () => {
  assert.equal(shouldShortCircuitCompletedAppointment('completed'), true);
  assert.equal(shouldShortCircuitCompletedAppointment('booked'), false);
});

test('remaining reaches zero => package should become completed', () => {
  const remaining = computePackageRemaining({
    sessionsTotal: 3,
    sessionsUsed: 3,
    maskTotal: 1,
    maskUsed: 1,
  });

  assert.equal(remaining.sessions_remaining, 0);
  assert.equal(deriveContinuousPackageStatus('active', remaining.sessions_remaining), 'completed');
});

test('revert restores remaining => package should become active again', () => {
  const remainingAfterRevert = computePackageRemaining({
    sessionsTotal: 3,
    sessionsUsed: 2,
    maskTotal: 1,
    maskUsed: 0,
  });

  assert.equal(remainingAfterRevert.sessions_remaining, 1);
  assert.equal(
    deriveContinuousPackageStatus('completed', remainingAfterRevert.sessions_remaining),
    'active'
  );
});

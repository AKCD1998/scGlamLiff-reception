import { Router } from 'express';
import {
  listAppointments,
  createAppointment,
  hardDeleteAppointment,
  softDeleteAppointment,
} from '../controllers/appointmentsController.js';
import requireAuth from '../middlewares/requireAuth.js';
import {
  cancelAppointment,
  completeAppointment,
  ensureAppointmentFromSheet,
  noShowAppointment,
  revertAppointment,
} from '../controllers/appointmentServiceController.js';

const router = Router();

// Ensure an appointments row exists for a sheet booking row (sheet_visits_raw.sheet_uuid).
router.post('/from-sheet/:sheetUuid/ensure', requireAuth, ensureAppointmentFromSheet);

router.get('/', listAppointments);
router.post('/', createAppointment);
router.post('/delete-hard', hardDeleteAppointment);
router.delete('/:id', softDeleteAppointment);

router.post('/:id/complete', requireAuth, completeAppointment);
router.post('/:id/cancel', requireAuth, cancelAppointment);
router.post('/:id/no-show', requireAuth, noShowAppointment);
router.post('/:id/revert', requireAuth, revertAppointment);

export default router;

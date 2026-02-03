import { Router } from 'express';
import {
  listAppointments,
  createAppointment,
  hardDeleteAppointment,
  softDeleteAppointment,
} from '../controllers/appointmentsController.js';

const router = Router();

router.get('/', listAppointments);
router.post('/', createAppointment);
router.post('/delete-hard', hardDeleteAppointment);
router.delete('/:id', softDeleteAppointment);

export default router;

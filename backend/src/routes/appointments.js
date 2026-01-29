import { Router } from 'express';
import {
  listAppointments,
  createAppointment,
  hardDeleteAppointment,
} from '../controllers/appointmentsController.js';

const router = Router();

router.get('/', listAppointments);
router.post('/', createAppointment);
router.post('/delete-hard', hardDeleteAppointment);

export default router;

import { Router } from 'express';
import { listAppointments, createAppointment } from '../controllers/appointmentsController.js';

const router = Router();

router.get('/', listAppointments);
router.post('/', createAppointment);

export default router;

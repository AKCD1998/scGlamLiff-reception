import { Router } from 'express';
import requireAuth from '../middlewares/requireAuth.js';
import requireAdmin from '../middlewares/requireAdmin.js';
import {
  getAdminAppointmentById,
  patchAdminAppointment,
} from '../controllers/adminAppointmentsController.js';

const router = Router();

router.get('/appointments/:appointmentId', requireAuth, requireAdmin, getAdminAppointmentById);
router.patch('/appointments/:appointmentId', requireAuth, requireAdmin, patchAdminAppointment);

export default router;

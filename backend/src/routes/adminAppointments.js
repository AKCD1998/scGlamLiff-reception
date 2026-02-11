import { Router } from 'express';
import requireAuth from '../middlewares/requireAuth.js';
import requireAdmin from '../middlewares/requireAdmin.js';
import {
  getAdminAppointmentById,
  patchAdminAppointment,
} from '../controllers/adminAppointmentsController.js';
import { createAdminStaffUser } from '../controllers/adminStaffUsersController.js';

const router = Router();

router.get('/appointments/:appointmentId', requireAuth, requireAdmin, getAdminAppointmentById);
router.patch('/appointments/:appointmentId', requireAuth, requireAdmin, patchAdminAppointment);
router.post('/staff-users', requireAuth, requireAdmin, createAdminStaffUser);

export default router;

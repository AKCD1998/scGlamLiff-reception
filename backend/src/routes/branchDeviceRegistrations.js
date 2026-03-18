import { Router } from 'express';
import requireAuth from '../middlewares/requireAuth.js';
import { createBranchDeviceGuardTraceMiddleware } from '../middlewares/branchDeviceGuardTrace.js';
import {
  createOrUpdateBranchDeviceRegistrationHandler,
  getBranchDeviceRegistrationMeHandler,
  listBranchDeviceRegistrationsHandler,
  patchBranchDeviceRegistrationHandler,
} from '../controllers/branchDeviceRegistrationsController.js';

const router = Router();

router.get('/me', createBranchDeviceGuardTraceMiddleware('me'), getBranchDeviceRegistrationMeHandler);
router.post(
  '/',
  createBranchDeviceGuardTraceMiddleware('register'),
  requireAuth,
  createOrUpdateBranchDeviceRegistrationHandler
);
router.get('/', requireAuth, listBranchDeviceRegistrationsHandler);
router.patch('/:id', requireAuth, patchBranchDeviceRegistrationHandler);

export default router;

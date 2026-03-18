import { Router } from 'express';
import requireAuth from '../middlewares/requireAuth.js';
import {
  createOrUpdateBranchDeviceRegistrationHandler,
  getBranchDeviceRegistrationMeHandler,
  listBranchDeviceRegistrationsHandler,
  patchBranchDeviceRegistrationHandler,
} from '../controllers/branchDeviceRegistrationsController.js';

const router = Router();

router.get('/me', getBranchDeviceRegistrationMeHandler);
router.post('/', requireAuth, createOrUpdateBranchDeviceRegistrationHandler);
router.get('/', requireAuth, listBranchDeviceRegistrationsHandler);
router.patch('/:id', requireAuth, patchBranchDeviceRegistrationHandler);

export default router;

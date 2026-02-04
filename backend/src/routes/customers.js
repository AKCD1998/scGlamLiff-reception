import { Router } from 'express';
import { listCustomers } from '../controllers/customersController.js';

const router = Router();

router.get('/', listCustomers);

export default router;

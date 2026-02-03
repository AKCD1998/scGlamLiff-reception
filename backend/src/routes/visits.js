import { Router } from 'express';
import { listVisits } from '../controllers/visitsController.js';

const router = Router();

router.get('/', listVisits);

export default router;

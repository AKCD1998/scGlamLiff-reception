import { Router } from 'express';
import { listVisits, createVisit } from '../controllers/visitsController.js';

const router = Router();

router.get('/', listVisits);
router.post('/', createVisit);

export default router;

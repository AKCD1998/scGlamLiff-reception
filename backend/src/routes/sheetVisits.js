import { Router } from 'express';
import requireAuth from '../middlewares/requireAuth.js';
import { deleteSheetVisit } from '../controllers/sheetVisitsController.js';

const router = Router();

router.post('/:sheetUuid/delete', requireAuth, deleteSheetVisit);

export default router;

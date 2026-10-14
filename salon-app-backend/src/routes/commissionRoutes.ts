import { Router } from 'express';
import { commissionController } from '../controllers/commissionController';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';

const router = Router();

router.get('/staff/:staffId', authMiddleware, commissionController.getByStaff);
router.get('/staff/:staffId/total', authMiddleware, commissionController.getTotalByStaff);
router.post('/pay', authMiddleware, requireRole(['admin']), commissionController.payCommission);

export default router;
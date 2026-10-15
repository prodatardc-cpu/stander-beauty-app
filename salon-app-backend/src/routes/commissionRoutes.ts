import { Router } from 'express';
import { policy } from '../config/permissions';
import { commissionController } from '../controllers/commissionController';
import { authMiddleware, requireOwnStaffDataOr, requireRole } from '../middleware/authMiddleware';
import { uuidParam } from '../middleware/validateParams';

const router = Router();
const ownOrAnyStaff = requireOwnStaffDataOr(policy.readAnyStaffFinancials);

router.use(authMiddleware);
router.param('staffId', uuidParam);
router.get('/staff/:staffId', ownOrAnyStaff, commissionController.getByStaff);
router.get('/staff/:staffId/total', ownOrAnyStaff, commissionController.getTotalByStaff);
router.post('/pay', requireRole(policy.payCommissions), commissionController.payCommission);

export default router;

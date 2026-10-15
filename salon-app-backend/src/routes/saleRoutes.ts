import { Router } from 'express';
import { policy } from '../config/permissions';
import { saleController } from '../controllers/saleController';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { uuidParam } from '../middleware/validateParams';

const router = Router();
const cancelSales = requireRole(policy.cancelSales);

router.use(authMiddleware);
router.param('id', uuidParam);
router.param('clientId', uuidParam);
router.post('/', saleController.create);
router.get('/', saleController.getAll);
router.get('/client/:clientId', saleController.getByClient);
router.delete('/reset', cancelSales, saleController.reset);
router.delete('/:id', cancelSales, saleController.removeById);

export default router;

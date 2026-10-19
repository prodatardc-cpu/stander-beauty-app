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
router.get('/:id', saleController.getOne);
router.post('/:id/payments', saleController.addPayment);
router.post('/:id/cancel', cancelSales, saleController.cancel);
router.delete('/:id', cancelSales, saleController.cancel);

export default router;

import { Router } from 'express';
import { saleController } from '../controllers/saleController';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';

const router = Router();
const adminOnly = requireRole(['admin']);

router.post('/', authMiddleware, saleController.create);
router.get('/', authMiddleware, saleController.getAll);
router.get('/client/:clientId', authMiddleware, saleController.getByClient);
router.delete('/reset', authMiddleware, adminOnly, saleController.reset);
router.delete('/:id', authMiddleware, adminOnly, saleController.removeById);

export default router;
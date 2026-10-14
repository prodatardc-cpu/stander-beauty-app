import { Router } from 'express';
import { clientController } from '../controllers/clientController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authMiddleware, clientController.getAll);
router.get('/search', authMiddleware, clientController.searchClient);
router.get('/:id', authMiddleware, clientController.getById);
router.post('/', authMiddleware, clientController.create);
router.put('/:id', authMiddleware, clientController.update);
router.delete('/:id', authMiddleware, clientController.remove);

export default router;
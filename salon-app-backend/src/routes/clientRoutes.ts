import { Router } from 'express';
import { policy } from '../config/permissions';
import { clientController } from '../controllers/clientController';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { uuidParam } from '../middleware/validateParams';

const router = Router();
const archiveClients = requireRole(policy.archiveClients);

router.use(authMiddleware);
router.param('id', uuidParam);
router.get('/', clientController.getAll);
router.get('/search', clientController.searchClient);
router.get('/:id', clientController.getById);
router.post('/', clientController.create);
router.put('/:id', clientController.update);
router.delete('/:id', archiveClients, clientController.remove);
router.post('/:id/restore', archiveClients, clientController.restore);

export default router;

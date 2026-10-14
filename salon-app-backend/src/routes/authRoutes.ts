import { Router } from 'express';
import { authController } from '../controllers/authController';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authMiddleware, authController.currentUser);
router.put('/password', authMiddleware, authController.changePassword);
router.post('/logout-all', authMiddleware, authController.logoutAll);
router.get('/users', authMiddleware, requireRole(['admin']), authController.listUsers);
router.post('/users', authMiddleware, requireRole(['admin']), authController.createUser);
router.patch('/users/:id', authMiddleware, requireRole(['admin']), authController.updateUser);
router.put('/users/:id/password', authMiddleware, requireRole(['admin']), authController.resetUserPassword);

export default router;
import { Router } from 'express';
import { policy } from '../config/permissions';
import { authController } from '../controllers/authController';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';

const router = Router();
const manageUsers = requireRole(policy.manageUsers);

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authMiddleware, authController.currentUser);
router.put('/password', authMiddleware, authController.changePassword);
router.post('/logout-all', authMiddleware, authController.logoutAll);
router.get('/users', authMiddleware, manageUsers, authController.listUsers);
router.post('/users', authMiddleware, manageUsers, authController.createUser);
router.patch('/users/:id', authMiddleware, manageUsers, authController.updateUser);
router.put('/users/:id/password', authMiddleware, manageUsers, authController.resetUserPassword);

export default router;

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { query } from '../db/pool';
import { authenticate } from '../middleware/auth';
import { logActivity } from '../utils/helpers';

const router = Router();

// POST /api/auth/login
router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { username, password } = req.body;
    const result = await query(
      `SELECT u.id, u.username, u.password_hash, u.full_name, u.initials, u.is_active, r.name AS role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.username = $1`,
      [username]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    const payload = { userId: user.id, username: user.username, role: user.role, fullName: user.full_name };
    const token = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' } as object);

    await logActivity(payload, 'User logged in', 'auth', user.id, req.ip);
    res.json({ token, user: { id: user.id, username: user.username, fullName: user.full_name, initials: user.initials, role: user.role } });
  }
);

// GET /api/auth/me
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  const result = await query(
    `SELECT u.id, u.username, u.full_name, u.initials, u.created_at, r.name AS role
     FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
    [req.user!.userId]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(result.rows[0]);
});

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }).withMessage('Min 6 characters'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { currentPassword, newPassword } = req.body;
    const result = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.userId]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return; }

    const hash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, req.user!.userId]);
    await logActivity(req.user, 'Changed password', 'user', req.user!.userId);
    res.json({ message: 'Password updated' });
  }
);

export default router;

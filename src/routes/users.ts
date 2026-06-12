import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { query } from '../db/pool';
import { authenticate, requireAdmin } from '../middleware/auth';
import { logActivity } from '../utils/helpers';

const router = Router();

// GET /api/users
router.get('/', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  const result = await query(
    `SELECT u.id, u.username, u.full_name, u.initials, u.is_active, u.created_at, r.name AS role
     FROM users u JOIN roles r ON u.role_id = r.id ORDER BY u.created_at`
  );
  res.json(result.rows);
});

// POST /api/users
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('username').trim().notEmpty(),
    body('password').isLength({ min: 6 }),
    body('fullName').trim().notEmpty(),
    body('role').isIn(['admin', 'manager', 'employee']),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { username, password, fullName, role } = req.body;
    const exists = await query(`SELECT id FROM users WHERE username = $1`, [username]);
    if (exists.rows.length > 0) { res.status(409).json({ error: 'Username already exists' }); return; }

    const roleRow = await query(`SELECT id FROM roles WHERE name = $1`, [role]);
    const hash = await bcrypt.hash(password, 12);
    const initials = fullName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

    const result = await query(
      `INSERT INTO users (username, password_hash, full_name, initials, role_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, username, full_name, initials`,
      [username, hash, fullName, initials, roleRow.rows[0].id]
    );
    await logActivity(req.user, `Created user: ${fullName}`, 'user', result.rows[0].id, req.ip);
    res.status(201).json(result.rows[0]);
  }
);

// PUT /api/users/:id — update name, role, and optionally password
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { fullName, role, password } = req.body;
  if (role && !['admin', 'manager', 'employee'].includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }

  let roleId: number | undefined;
  if (role) {
    const roleRow = await query(`SELECT id FROM roles WHERE name = $1`, [role]);
    roleId = roleRow.rows[0]?.id;
  }
  const initials = fullName ? fullName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) : undefined;
  const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;

  const result = await query(
    `UPDATE users SET
       full_name = COALESCE($1, full_name),
       initials = COALESCE($2, initials),
       role_id = COALESCE($3, role_id),
       password_hash = COALESCE($4, password_hash),
       updated_at = NOW()
     WHERE id = $5 RETURNING id, username, full_name, initials`,
    [fullName ?? null, initials ?? null, roleId ?? null, passwordHash ?? null, req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  await logActivity(req.user, `Updated user: ${result.rows[0].full_name}`, 'user', req.params.id);
  res.json(result.rows[0]);
});

// PATCH /api/users/:id/role
router.patch('/:id/role', authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { role } = req.body;
  if (!['admin', 'manager', 'employee'].includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
  const roleRow = await query(`SELECT id FROM roles WHERE name = $1`, [role]);
  await query(`UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2`, [roleRow.rows[0].id, req.params.id]);
  await logActivity(req.user, `Changed role of user ${req.params.id} to ${role}`, 'user', req.params.id);
  res.json({ message: 'Role updated' });
});

// DELETE /api/users/:id  (soft-deactivate)
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  if (req.params.id === req.user!.userId) { res.status(400).json({ error: 'Cannot deactivate yourself' }); return; }
  await query(`UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [req.params.id]);
  await logActivity(req.user, `Deactivated user ${req.params.id}`, 'user', req.params.id);
  res.json({ message: 'User deactivated' });
});

export default router;

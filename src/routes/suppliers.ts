import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query } from '../db/pool';
import { authenticate, requireNotEmployee } from '../middleware/auth';
import { logActivity } from '../utils/helpers';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response) => {
  const search = req.query.search as string | undefined;
  const result = await query(
    `SELECT * FROM suppliers WHERE deleted_at IS NULL
     AND ($1::TEXT IS NULL OR name ILIKE '%'||$1||'%' OR contact_person ILIKE '%'||$1||'%')
     ORDER BY name`,
    [search ?? null]
  );
  res.json(result.rows);
});

router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  const result = await query(`SELECT * FROM suppliers WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(result.rows[0]);
});

router.post(
  '/',
  authenticate,
  requireNotEmployee,
  [body('name').trim().notEmpty()],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }
    const { name, contact_person, phone, notes } = req.body;
    const result = await query(
      `INSERT INTO suppliers (name, contact_person, phone, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, contact_person ?? null, phone ?? null, notes ?? null]
    );
    await logActivity(req.user, `Added supplier: ${name}`, 'supplier', result.rows[0].id, req.ip);
    res.status(201).json(result.rows[0]);
  }
);

router.put('/:id', authenticate, requireNotEmployee, async (req: Request, res: Response): Promise<void> => {
  const { name, contact_person, phone, notes } = req.body;
  const result = await query(
    `UPDATE suppliers SET name=$1, contact_person=$2, phone=$3, notes=$4, updated_at=NOW()
     WHERE id=$5 AND deleted_at IS NULL RETURNING *`,
    [name, contact_person ?? null, phone ?? null, notes ?? null, req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  await logActivity(req.user, `Updated supplier: ${name}`, 'supplier', req.params.id);
  res.json(result.rows[0]);
});

router.delete('/:id', authenticate, requireNotEmployee, async (req: Request, res: Response): Promise<void> => {
  const result = await query(
    `UPDATE suppliers SET deleted_at = NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING name`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  await query(
    `INSERT INTO recycle_bin (entity_type, entity_id, entity_label, deleted_by) VALUES ('supplier',$1,$2,$3)`,
    [req.params.id, result.rows[0].name, req.user!.userId]
  );
  await logActivity(req.user, `Deleted supplier: ${result.rows[0].name}`, 'supplier', req.params.id);
  res.json({ message: 'Deleted' });
});

export default router;

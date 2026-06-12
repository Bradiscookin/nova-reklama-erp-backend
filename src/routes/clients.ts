import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query } from '../db/pool';
import { authenticate, requireNotEmployee } from '../middleware/auth';
import { logActivity } from '../utils/helpers';

const router = Router();

// GET /api/clients
router.get('/', authenticate, async (req: Request, res: Response) => {
  const search = req.query.search as string | undefined;
  const result = await query(
    `SELECT c.*,
       COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') AS contacts
     FROM clients c
     LEFT JOIN client_contacts cc ON cc.client_id = c.id
     WHERE c.deleted_at IS NULL
       AND ($1::TEXT IS NULL OR c.name ILIKE '%' || $1 || '%'
         OR EXISTS (SELECT 1 FROM client_contacts x WHERE x.client_id = c.id AND x.phone ILIKE '%' || $1 || '%'))
     GROUP BY c.id
     ORDER BY c.name`,
    [search ?? null]
  );
  res.json(result.rows);
});

// GET /api/clients/:id
router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  const result = await query(
    `SELECT c.*,
       COALESCE(json_agg(cc.*) FILTER (WHERE cc.id IS NOT NULL), '[]') AS contacts
     FROM clients c LEFT JOIN client_contacts cc ON cc.client_id = c.id
     WHERE c.id = $1 AND c.deleted_at IS NULL GROUP BY c.id`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(result.rows[0]);
});

// POST /api/clients
router.post(
  '/',
  authenticate,
  requireNotEmployee,
  [body('name').trim().notEmpty().withMessage('Company name required')],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { name, address, notes, contacts } = req.body;
    const result = await query(
      `INSERT INTO clients (name, address, notes) VALUES ($1,$2,$3) RETURNING *`,
      [name, address ?? null, notes ?? null]
    );
    const client = result.rows[0];

    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        await query(
          `INSERT INTO client_contacts (client_id, full_name, position, phone, telegram, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [client.id, c.fullName, c.position ?? null, c.phone ?? null, c.telegram ?? null, c.notes ?? null]
        );
      }
    }
    await logActivity(req.user, `Added client: ${name}`, 'client', client.id, req.ip);
    res.status(201).json(client);
  }
);

// PUT /api/clients/:id
router.put('/:id', authenticate, requireNotEmployee, async (req: Request, res: Response): Promise<void> => {
  const { name, address, notes, outstanding_debt, contacts } = req.body;
  const result = await query(
    `UPDATE clients SET name=$1, address=$2, notes=$3, outstanding_debt=COALESCE($4, outstanding_debt), updated_at=NOW()
     WHERE id=$5 AND deleted_at IS NULL RETURNING *`,
    [name, address ?? null, notes ?? null, outstanding_debt ?? null, req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }

  if (Array.isArray(contacts)) {
    await query(`DELETE FROM client_contacts WHERE client_id = $1`, [req.params.id]);
    for (const c of contacts) {
      await query(
        `INSERT INTO client_contacts (client_id, full_name, position, phone, telegram, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
        [req.params.id, c.fullName, c.position ?? null, c.phone ?? null, c.telegram ?? null, c.notes ?? null]
      );
    }
  }
  await logActivity(req.user, `Updated client: ${name}`, 'client', req.params.id);
  res.json(result.rows[0]);
});

// DELETE /api/clients/:id  (soft delete)
router.delete('/:id', authenticate, requireNotEmployee, async (req: Request, res: Response): Promise<void> => {
  const result = await query(
    `UPDATE clients SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING name`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  await query(
    `INSERT INTO recycle_bin (entity_type, entity_id, entity_label, deleted_by) VALUES ('client', $1, $2, $3)`,
    [req.params.id, result.rows[0].name, req.user!.userId]
  );
  await logActivity(req.user, `Deleted client: ${result.rows[0].name}`, 'client', req.params.id);
  res.json({ message: 'Deleted' });
});

export default router;

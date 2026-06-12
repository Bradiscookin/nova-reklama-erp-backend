import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query, getClient } from '../db/pool';
import { authenticate, requireAdmin, requireNotEmployee } from '../middleware/auth';
import { logActivity } from '../utils/helpers';

const router = Router();

// ── CATEGORIES & UNITS ────────────────────────────────────────────────────
router.get('/categories', authenticate, async (_req, res) => {
  const r = await query(`SELECT * FROM material_categories ORDER BY name`);
  res.json(r.rows);
});
router.post('/categories', authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body;
  if (!name) { res.status(400).json({ error: 'Name required' }); return; }
  const r = await query(`INSERT INTO material_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *`, [name]);
  res.status(201).json(r.rows[0]);
});

router.get('/units', authenticate, async (_req, res) => {
  const r = await query(`SELECT * FROM units ORDER BY name`);
  res.json(r.rows);
});
router.post('/units', authenticate, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body;
  if (!name) { res.status(400).json({ error: 'Name required' }); return; }
  const r = await query(`INSERT INTO units (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *`, [name]);
  res.status(201).json(r.rows[0]);
});

// ── MATERIALS ─────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { search, category, lowStock } = req.query;
  const result = await query(
    `SELECT m.*, mc.name AS category_name, u.name AS unit_name, s.name AS supplier_name,
       (m.quantity - m.reserved_qty) AS available_qty,
       CASE
         WHEN m.min_qty = 0 THEN 'green'
         WHEN (m.quantity - m.reserved_qty) / NULLIF(m.min_qty, 0) >= 0.5 THEN 'green'
         WHEN (m.quantity - m.reserved_qty) / NULLIF(m.min_qty, 0) >= 0.2 THEN 'yellow'
         ELSE 'red'
       END AS stock_status
     FROM materials m
     LEFT JOIN material_categories mc ON mc.id = m.category_id
     LEFT JOIN units u ON u.id = m.unit_id
     LEFT JOIN suppliers s ON s.id = m.supplier_id
     WHERE m.deleted_at IS NULL
       AND ($1::TEXT IS NULL OR m.name ILIKE '%'||$1||'%' OR m.sku ILIKE '%'||$1||'%')
       AND ($2::TEXT IS NULL OR mc.name = $2)
       AND ($3::BOOLEAN IS NULL OR ($3 = TRUE AND (m.quantity - m.reserved_qty) < m.min_qty))
     ORDER BY m.name`,
    [search ?? null, category ?? null, lowStock === 'true' ? true : null]
  );
  res.json(result.rows);
});

router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  const result = await query(
    `SELECT m.*, mc.name AS category_name, u.name AS unit_name, s.name AS supplier_name,
       (m.quantity - m.reserved_qty) AS available_qty
     FROM materials m
     LEFT JOIN material_categories mc ON mc.id = m.category_id
     LEFT JOIN units u ON u.id = m.unit_id
     LEFT JOIN suppliers s ON s.id = m.supplier_id
     WHERE m.id = $1 AND m.deleted_at IS NULL`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(result.rows[0]);
});

router.post(
  '/',
  authenticate,
  requireNotEmployee,
  [body('sku').trim().notEmpty(), body('name').trim().notEmpty()],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { sku, name, category_id, unit_id, quantity, min_qty, purchase_price, supplier_id, notes } = req.body;
    const skuCheck = await query(`SELECT id FROM materials WHERE sku = $1`, [sku]);
    if (skuCheck.rows.length > 0) { res.status(409).json({ error: 'SKU already exists' }); return; }

    const result = await query(
      `INSERT INTO materials (sku, name, category_id, unit_id, quantity, min_qty, purchase_price, supplier_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [sku, name, category_id ?? null, unit_id ?? null, quantity ?? 0, min_qty ?? 0, purchase_price ?? 0, supplier_id ?? null, notes ?? null]
    );
    await logActivity(req.user, `Added material: ${name} (${sku})`, 'material', result.rows[0].id, req.ip);
    res.status(201).json(result.rows[0]);
  }
);

router.put('/:id', authenticate, requireNotEmployee, async (req: Request, res: Response): Promise<void> => {
  const { sku, name, category_id, unit_id, min_qty, purchase_price, supplier_id, notes } = req.body;
  const result = await query(
    `UPDATE materials SET sku=$1, name=$2, category_id=$3, unit_id=$4, min_qty=$5, purchase_price=$6,
       supplier_id=$7, notes=$8, updated_at=NOW()
     WHERE id=$9 AND deleted_at IS NULL RETURNING *`,
    [sku, name, category_id ?? null, unit_id ?? null, min_qty ?? 0, purchase_price ?? 0, supplier_id ?? null, notes ?? null, req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  await logActivity(req.user, `Updated material: ${name}`, 'material', req.params.id);
  res.json(result.rows[0]);
});

router.delete('/:id', authenticate, requireNotEmployee, async (req: Request, res: Response): Promise<void> => {
  const result = await query(
    `UPDATE materials SET deleted_at = NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING name, sku`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  await query(`INSERT INTO recycle_bin (entity_type, entity_id, entity_label, deleted_by) VALUES ('material',$1,$2,$3)`,
    [req.params.id, `${result.rows[0].sku} — ${result.rows[0].name}`, req.user!.userId]);
  await logActivity(req.user, `Deleted material: ${result.rows[0].name}`, 'material', req.params.id);
  res.json({ message: 'Deleted' });
});

// ── STOCK MOVEMENTS ───────────────────────────────────────────────────────
router.get('/:id/movements', authenticate, async (req: Request, res: Response) => {
  const result = await query(
    `SELECT mm.*, u.full_name AS user_name, o.order_number
     FROM material_movements mm
     LEFT JOIN users u ON u.id = mm.user_id
     LEFT JOIN orders o ON o.id = mm.order_id
     WHERE mm.material_id = $1 ORDER BY mm.created_at DESC LIMIT 100`,
    [req.params.id]
  );
  res.json(result.rows);
});

router.post(
  '/movements',
  authenticate,
  [
    body('materialId').notEmpty(),
    body('movementType').isIn(['stock_in','stock_out','reserve','unreserve','return','manual_correction']),
    body('quantity').isFloat({ gt: 0 }),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { materialId, movementType, quantity, orderId, notes } = req.body;
      const matRes = await client.query(
        `SELECT id, name, quantity, reserved_qty, unit_id FROM materials WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [materialId]
      );
      if (!matRes.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Material not found' }); return; }

      const mat = matRes.rows[0];
      let newQty = parseFloat(mat.quantity);
      let newReserved = parseFloat(mat.reserved_qty);
      const qty = parseFloat(quantity);

      switch (movementType) {
        case 'stock_in':          newQty += qty; break;
        case 'stock_out':
          if (newQty - newReserved < qty) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Insufficient available stock' }); return; }
          newQty -= qty; break;
        case 'reserve':
          if (newQty - newReserved < qty) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Insufficient available stock to reserve' }); return; }
          newReserved += qty; break;
        case 'unreserve':         newReserved = Math.max(0, newReserved - qty); break;
        case 'return':            newQty += qty; break;
        case 'manual_correction': newQty = qty; break;
      }

      await client.query(
        `UPDATE materials SET quantity=$1, reserved_qty=$2, updated_at=NOW() WHERE id=$3`,
        [newQty, newReserved, materialId]
      );
      await client.query(
        `INSERT INTO material_movements (material_id, user_id, movement_type, quantity, qty_before, qty_after, order_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [materialId, req.user!.userId, movementType, qty, mat.quantity, newQty, orderId ?? null, notes ?? null]
      );

      // Low stock notification
      if (newQty < parseFloat(mat.min_qty ?? '0')) {
        const adminUsers = await client.query(`SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.name='admin' AND u.is_active=TRUE`);
        for (const admin of adminUsers.rows) {
          await client.query(
            `INSERT INTO notifications (user_id, type, title, body) VALUES ($1,'low_stock',$2,$3)`,
            [admin.id, `Low stock: ${mat.name}`, `Stock is now ${newQty} (min: ${mat.min_qty})`]
          );
        }
      }

      await client.query('COMMIT');
      await logActivity(req.user, `${movementType}: ${qty} of ${mat.name}`, 'material', materialId, req.ip);
      res.status(201).json({ message: 'Movement recorded', newQty, newReserved });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
);

export default router;

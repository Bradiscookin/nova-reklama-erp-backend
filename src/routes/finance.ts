import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query } from '../db/pool';
import { authenticate, requireNotEmployee } from '../middleware/auth';
import { logActivity } from '../utils/helpers';

const router = Router();

// GET /api/finance — unified list of payments (income) and expenses
router.get('/', authenticate, requireNotEmployee, async (_req: Request, res: Response) => {
  const result = await query(`
    SELECT id, 'income' AS type, payment_date AS date, description AS desc,
           (SELECT name FROM clients WHERE id = client_id) AS party, amount, currency
    FROM payments WHERE deleted_at IS NULL
    UNION ALL
    SELECT id, 'expense' AS type, expense_date AS date, description AS desc,
           category AS party, amount, currency
    FROM expenses WHERE deleted_at IS NULL
    ORDER BY date DESC
  `);
  res.json(result.rows);
});

// POST /api/finance
router.post(
  '/',
  authenticate,
  requireNotEmployee,
  [
    body('type').isIn(['income', 'expense']).withMessage('type must be income or expense'),
    body('desc').trim().notEmpty().withMessage('Description is required'),
    body('amount').isNumeric().withMessage('Amount must be a number'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { type, date, desc, party, amount, currency } = req.body;
    let row;
    if (type === 'income') {
      const r = await query(
        `INSERT INTO payments (amount, currency, payment_date, description, recorded_by)
         VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5) RETURNING id, payment_date AS date, description AS desc, amount, currency`,
        [amount, currency ?? 'UZS', date ?? null, desc, req.user!.userId]
      );
      row = { ...r.rows[0], type: 'income', party: party ?? null };
    } else {
      const r = await query(
        `INSERT INTO expenses (amount, currency, category, description, expense_date, recorded_by)
         VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6) RETURNING id, expense_date AS date, description AS desc, amount, currency`,
        [amount, currency ?? 'UZS', party ?? null, desc, date ?? null, req.user!.userId]
      );
      row = { ...r.rows[0], type: 'expense', party: party ?? null };
    }
    await logActivity(req.user, `Added ${type}: ${desc} (${amount} ${currency ?? 'UZS'})`, 'finance', row.id, req.ip);
    res.status(201).json(row);
  }
);

// DELETE /api/finance/:id?type=income|expense
router.delete('/:id', authenticate, requireNotEmployee, async (req: Request, res: Response): Promise<void> => {
  const type = req.query.type as string;
  const table = type === 'income' ? 'payments' : type === 'expense' ? 'expenses' : null;
  if (!table) { res.status(400).json({ error: 'type query param must be income or expense' }); return; }

  const result = await query(
    `UPDATE ${table} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING description`,
    [req.params.id]
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  await logActivity(req.user, `Deleted ${type} entry: ${result.rows[0].description}`, 'finance', req.params.id);
  res.json({ message: 'Deleted' });
});

export default router;

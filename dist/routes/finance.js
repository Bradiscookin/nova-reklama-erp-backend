"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
// GET /api/finance — unified list of payments (income) and expenses
router.get('/', auth_1.authenticate, auth_1.requireNotEmployee, async (_req, res) => {
    const result = await (0, pool_1.query)(`
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
router.post('/', auth_1.authenticate, auth_1.requireNotEmployee, [
    (0, express_validator_1.body)('type').isIn(['income', 'expense']).withMessage('type must be income or expense'),
    (0, express_validator_1.body)('desc').trim().notEmpty().withMessage('Description is required'),
    (0, express_validator_1.body)('amount').isNumeric().withMessage('Amount must be a number'),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    const { type, date, desc, party, amount, currency } = req.body;
    let row;
    if (type === 'income') {
        const r = await (0, pool_1.query)(`INSERT INTO payments (amount, currency, payment_date, description, recorded_by)
         VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5) RETURNING id, payment_date AS date, description AS desc, amount, currency`, [amount, currency ?? 'UZS', date ?? null, desc, req.user.userId]);
        row = { ...r.rows[0], type: 'income', party: party ?? null };
    }
    else {
        const r = await (0, pool_1.query)(`INSERT INTO expenses (amount, currency, category, description, expense_date, recorded_by)
         VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6) RETURNING id, expense_date AS date, description AS desc, amount, currency`, [amount, currency ?? 'UZS', party ?? null, desc, date ?? null, req.user.userId]);
        row = { ...r.rows[0], type: 'expense', party: party ?? null };
    }
    await (0, helpers_1.logActivity)(req.user, `Added ${type}: ${desc} (${amount} ${currency ?? 'UZS'})`, 'finance', row.id, req.ip);
    res.status(201).json(row);
});
// DELETE /api/finance/:id?type=income|expense
router.delete('/:id', auth_1.authenticate, auth_1.requireNotEmployee, async (req, res) => {
    const type = req.query.type;
    const table = type === 'income' ? 'payments' : type === 'expense' ? 'expenses' : null;
    if (!table) {
        res.status(400).json({ error: 'type query param must be income or expense' });
        return;
    }
    const result = await (0, pool_1.query)(`UPDATE ${table} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING description`, [req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await (0, helpers_1.logActivity)(req.user, `Deleted ${type} entry: ${result.rows[0].description}`, 'finance', req.params.id);
    res.json({ message: 'Deleted' });
});
exports.default = router;
//# sourceMappingURL=finance.js.map
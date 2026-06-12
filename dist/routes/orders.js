"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
const STATUS_NAMES = ['New', 'Approval', 'Production', 'Installation', 'Completed', 'Closed', 'Cancelled'];
const ensureStatuses = async () => {
    for (let i = 0; i < STATUS_NAMES.length; i++) {
        await (0, pool_1.query)(`INSERT INTO order_statuses (name, sort_order) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`, [STATUS_NAMES[i], i]);
    }
};
// GET /api/orders
router.get('/', auth_1.authenticate, async (req, res) => {
    const { search, status } = req.query;
    const result = await (0, pool_1.query)(`SELECT o.*, c.name AS client_name, s.name AS status_name
     FROM orders o
     LEFT JOIN clients c ON c.id = o.client_id
     LEFT JOIN order_statuses s ON s.id = o.status_id
     WHERE o.deleted_at IS NULL
       AND ($1::TEXT IS NULL OR o.title ILIKE '%'||$1||'%' OR o.order_number ILIKE '%'||$1||'%' OR c.name ILIKE '%'||$1||'%')
       AND ($2::TEXT IS NULL OR s.name = $2)
     ORDER BY o.is_urgent DESC, o.created_at DESC`, [search ?? null, status ?? null]);
    res.json(result.rows);
});
// GET /api/orders/:id
router.get('/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, pool_1.query)(`SELECT o.*, c.name AS client_name, s.name AS status_name
     FROM orders o
     LEFT JOIN clients c ON c.id = o.client_id
     LEFT JOIN order_statuses s ON s.id = o.status_id
     WHERE o.id = $1 AND o.deleted_at IS NULL`, [req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(result.rows[0]);
});
// POST /api/orders
router.post('/', auth_1.authenticate, [
    (0, express_validator_1.body)('title').trim().notEmpty().withMessage('Title is required'),
    (0, express_validator_1.body)('clientId').notEmpty().withMessage('Client is required'),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    await ensureStatuses();
    const { title, description, clientId, amount, currency, startDate, dueDate, isUrgent, status, filePath } = req.body;
    const statusRes = await (0, pool_1.query)(`SELECT id FROM order_statuses WHERE name = $1`, [status || 'New']);
    const statusId = statusRes.rows[0]?.id ?? (await (0, pool_1.query)(`SELECT id FROM order_statuses WHERE name='New'`)).rows[0].id;
    const orderNumber = await (0, helpers_1.generateOrderNumber)();
    const result = await (0, pool_1.query)(`INSERT INTO orders (order_number, client_id, title, description, amount, currency, start_date, due_date, is_urgent, status_id, file_storage_path, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [orderNumber, clientId, title, description ?? null, amount ?? 0, currency ?? 'UZS', startDate ?? null, dueDate ?? null, !!isUrgent, statusId, filePath ?? null, req.user.userId]);
    await (0, helpers_1.logActivity)(req.user, `Created order ${orderNumber}: ${title}`, 'order', result.rows[0].id, req.ip);
    res.status(201).json(result.rows[0]);
});
// PUT /api/orders/:id
router.put('/:id', auth_1.authenticate, async (req, res) => {
    await ensureStatuses();
    const { title, description, clientId, amount, currency, startDate, dueDate, isUrgent, status, filePath } = req.body;
    let statusId;
    if (status) {
        const statusRes = await (0, pool_1.query)(`SELECT id FROM order_statuses WHERE name = $1`, [status]);
        statusId = statusRes.rows[0]?.id;
    }
    const result = await (0, pool_1.query)(`UPDATE orders SET
       title = COALESCE($1, title),
       description = $2,
       client_id = COALESCE($3, client_id),
       amount = COALESCE($4, amount),
       currency = COALESCE($5, currency),
       start_date = $6,
       due_date = $7,
       is_urgent = COALESCE($8, is_urgent),
       status_id = COALESCE($9, status_id),
       file_storage_path = $10,
       updated_at = NOW()
     WHERE id = $11 AND deleted_at IS NULL RETURNING *`, [title ?? null, description ?? null, clientId ?? null, amount ?? null, currency ?? null, startDate ?? null, dueDate ?? null, isUrgent, statusId ?? null, filePath ?? null, req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await (0, helpers_1.logActivity)(req.user, `Updated order ${result.rows[0].order_number}`, 'order', req.params.id);
    res.json(result.rows[0]);
});
// PUT /api/orders/:id/status
router.put('/:id/status', auth_1.authenticate, async (req, res) => {
    const { status } = req.body;
    if (!status) {
        res.status(400).json({ error: 'status is required' });
        return;
    }
    await ensureStatuses();
    const statusRes = await (0, pool_1.query)(`SELECT id FROM order_statuses WHERE name = $1`, [status]);
    if (!statusRes.rows[0]) {
        res.status(400).json({ error: 'Invalid status' });
        return;
    }
    const result = await (0, pool_1.query)(`UPDATE orders SET status_id = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING *`, [statusRes.rows[0].id, req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await (0, helpers_1.logActivity)(req.user, `Changed status of order ${result.rows[0].order_number} to ${status}`, 'order', req.params.id);
    res.json(result.rows[0]);
});
// DELETE /api/orders/:id (soft delete)
router.delete('/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, pool_1.query)(`UPDATE orders SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING order_number, title`, [req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await (0, pool_1.query)(`INSERT INTO recycle_bin (entity_type, entity_id, entity_label, deleted_by) VALUES ('order', $1, $2, $3)`, [req.params.id, `${result.rows[0].order_number} — ${result.rows[0].title}`, req.user.userId]);
    await (0, helpers_1.logActivity)(req.user, `Deleted order ${result.rows[0].order_number}`, 'order', req.params.id);
    res.json({ message: 'Deleted' });
});
exports.default = router;
//# sourceMappingURL=orders.js.map
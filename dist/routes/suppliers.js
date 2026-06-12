"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
router.get('/', auth_1.authenticate, async (req, res) => {
    const search = req.query.search;
    const result = await (0, pool_1.query)(`SELECT * FROM suppliers WHERE deleted_at IS NULL
     AND ($1::TEXT IS NULL OR name ILIKE '%'||$1||'%' OR contact_person ILIKE '%'||$1||'%')
     ORDER BY name`, [search ?? null]);
    res.json(result.rows);
});
router.get('/:id', auth_1.authenticate, async (req, res) => {
    const result = await (0, pool_1.query)(`SELECT * FROM suppliers WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(result.rows[0]);
});
router.post('/', auth_1.authenticate, auth_1.requireNotEmployee, [(0, express_validator_1.body)('name').trim().notEmpty()], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    const { name, contact_person, phone, notes } = req.body;
    const result = await (0, pool_1.query)(`INSERT INTO suppliers (name, contact_person, phone, notes) VALUES ($1,$2,$3,$4) RETURNING *`, [name, contact_person ?? null, phone ?? null, notes ?? null]);
    await (0, helpers_1.logActivity)(req.user, `Added supplier: ${name}`, 'supplier', result.rows[0].id, req.ip);
    res.status(201).json(result.rows[0]);
});
router.put('/:id', auth_1.authenticate, auth_1.requireNotEmployee, async (req, res) => {
    const { name, contact_person, phone, notes } = req.body;
    const result = await (0, pool_1.query)(`UPDATE suppliers SET name=$1, contact_person=$2, phone=$3, notes=$4, updated_at=NOW()
     WHERE id=$5 AND deleted_at IS NULL RETURNING *`, [name, contact_person ?? null, phone ?? null, notes ?? null, req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await (0, helpers_1.logActivity)(req.user, `Updated supplier: ${name}`, 'supplier', req.params.id);
    res.json(result.rows[0]);
});
router.delete('/:id', auth_1.authenticate, auth_1.requireNotEmployee, async (req, res) => {
    const result = await (0, pool_1.query)(`UPDATE suppliers SET deleted_at = NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING name`, [req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await (0, pool_1.query)(`INSERT INTO recycle_bin (entity_type, entity_id, entity_label, deleted_by) VALUES ('supplier',$1,$2,$3)`, [req.params.id, result.rows[0].name, req.user.userId]);
    await (0, helpers_1.logActivity)(req.user, `Deleted supplier: ${result.rows[0].name}`, 'supplier', req.params.id);
    res.json({ message: 'Deleted' });
});
exports.default = router;
//# sourceMappingURL=suppliers.js.map
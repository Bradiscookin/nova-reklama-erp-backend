"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_validator_1 = require("express-validator");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
// GET /api/users
router.get('/', auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const result = await (0, pool_1.query)(`SELECT u.id, u.username, u.full_name, u.initials, u.is_active, u.created_at, r.name AS role
     FROM users u JOIN roles r ON u.role_id = r.id ORDER BY u.created_at`);
    res.json(result.rows);
});
// POST /api/users
router.post('/', auth_1.authenticate, auth_1.requireAdmin, [
    (0, express_validator_1.body)('username').trim().notEmpty(),
    (0, express_validator_1.body)('password').isLength({ min: 6 }),
    (0, express_validator_1.body)('fullName').trim().notEmpty(),
    (0, express_validator_1.body)('role').isIn(['admin', 'manager', 'employee']),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    const { username, password, fullName, role } = req.body;
    const exists = await (0, pool_1.query)(`SELECT id FROM users WHERE username = $1`, [username]);
    if (exists.rows.length > 0) {
        res.status(409).json({ error: 'Username already exists' });
        return;
    }
    const roleRow = await (0, pool_1.query)(`SELECT id FROM roles WHERE name = $1`, [role]);
    const hash = await bcryptjs_1.default.hash(password, 12);
    const initials = fullName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
    const result = await (0, pool_1.query)(`INSERT INTO users (username, password_hash, full_name, initials, role_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, username, full_name, initials`, [username, hash, fullName, initials, roleRow.rows[0].id]);
    await (0, helpers_1.logActivity)(req.user, `Created user: ${fullName}`, 'user', result.rows[0].id, req.ip);
    res.status(201).json(result.rows[0]);
});
// PUT /api/users/:id — update name, role, and optionally password
router.put('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { fullName, role, password } = req.body;
    if (role && !['admin', 'manager', 'employee'].includes(role)) {
        res.status(400).json({ error: 'Invalid role' });
        return;
    }
    let roleId;
    if (role) {
        const roleRow = await (0, pool_1.query)(`SELECT id FROM roles WHERE name = $1`, [role]);
        roleId = roleRow.rows[0]?.id;
    }
    const initials = fullName ? fullName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : undefined;
    const passwordHash = password ? await bcryptjs_1.default.hash(password, 12) : undefined;
    const result = await (0, pool_1.query)(`UPDATE users SET
       full_name = COALESCE($1, full_name),
       initials = COALESCE($2, initials),
       role_id = COALESCE($3, role_id),
       password_hash = COALESCE($4, password_hash),
       updated_at = NOW()
     WHERE id = $5 RETURNING id, username, full_name, initials`, [fullName ?? null, initials ?? null, roleId ?? null, passwordHash ?? null, req.params.id]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    await (0, helpers_1.logActivity)(req.user, `Updated user: ${result.rows[0].full_name}`, 'user', req.params.id);
    res.json(result.rows[0]);
});
// PATCH /api/users/:id/role
router.patch('/:id/role', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { role } = req.body;
    if (!['admin', 'manager', 'employee'].includes(role)) {
        res.status(400).json({ error: 'Invalid role' });
        return;
    }
    const roleRow = await (0, pool_1.query)(`SELECT id FROM roles WHERE name = $1`, [role]);
    await (0, pool_1.query)(`UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2`, [roleRow.rows[0].id, req.params.id]);
    await (0, helpers_1.logActivity)(req.user, `Changed role of user ${req.params.id} to ${role}`, 'user', req.params.id);
    res.json({ message: 'Role updated' });
});
// DELETE /api/users/:id  (soft-deactivate)
router.delete('/:id', auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    if (req.params.id === req.user.userId) {
        res.status(400).json({ error: 'Cannot deactivate yourself' });
        return;
    }
    await (0, pool_1.query)(`UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [req.params.id]);
    await (0, helpers_1.logActivity)(req.user, `Deactivated user ${req.params.id}`, 'user', req.params.id);
    res.json({ message: 'User deactivated' });
});
exports.default = router;
//# sourceMappingURL=users.js.map
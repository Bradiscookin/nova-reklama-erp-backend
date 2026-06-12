"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_validator_1 = require("express-validator");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
// POST /api/auth/login
router.post('/login', [
    (0, express_validator_1.body)('username').trim().notEmpty().withMessage('Username is required'),
    (0, express_validator_1.body)('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    const { username, password } = req.body;
    const result = await (0, pool_1.query)(`SELECT u.id, u.username, u.password_hash, u.full_name, u.initials, u.is_active, r.name AS role
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.username = $1`, [username]);
    const user = result.rows[0];
    if (!user || !user.is_active) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const valid = await bcryptjs_1.default.compare(password, user.password_hash);
    if (!valid) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const payload = { userId: user.id, username: user.username, role: user.role, fullName: user.full_name };
    const token = jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    await (0, helpers_1.logActivity)(payload, 'User logged in', 'auth', user.id, req.ip);
    res.json({ token, user: { id: user.id, username: user.username, fullName: user.full_name, initials: user.initials, role: user.role } });
});
// GET /api/auth/me
router.get('/me', auth_1.authenticate, async (req, res) => {
    const result = await (0, pool_1.query)(`SELECT u.id, u.username, u.full_name, u.initials, u.created_at, r.name AS role
     FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`, [req.user.userId]);
    if (!result.rows[0]) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(result.rows[0]);
});
// POST /api/auth/change-password
router.post('/change-password', auth_1.authenticate, [
    (0, express_validator_1.body)('currentPassword').notEmpty(),
    (0, express_validator_1.body)('newPassword').isLength({ min: 6 }).withMessage('Min 6 characters'),
], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }
    const { currentPassword, newPassword } = req.body;
    const result = await (0, pool_1.query)(`SELECT password_hash FROM users WHERE id = $1`, [req.user.userId]);
    const valid = await bcryptjs_1.default.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
    }
    const hash = await bcryptjs_1.default.hash(newPassword, 12);
    await (0, pool_1.query)(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, req.user.userId]);
    await (0, helpers_1.logActivity)(req.user, 'Changed password', 'user', req.user.userId);
    res.json({ message: 'Password updated' });
});
exports.default = router;
//# sourceMappingURL=auth.js.map
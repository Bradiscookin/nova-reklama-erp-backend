"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOrderNumber = exports.logActivity = void 0;
const pool_1 = require("../db/pool");
const logActivity = async (user, action, entityType, entityId, ipAddress) => {
    try {
        await (0, pool_1.query)(`INSERT INTO activity_logs (user_id, user_name, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`, [user?.userId ?? null, user?.fullName ?? 'System', action, entityType ?? null, entityId ?? null, ipAddress ?? null]);
    }
    catch (err) {
        console.error('Failed to write activity log:', err);
    }
};
exports.logActivity = logActivity;
const generateOrderNumber = async () => {
    const year = new Date().getFullYear();
    const res = await (0, pool_1.query)(`SELECT COUNT(*) FROM orders WHERE order_number LIKE $1`, [`${year}-%`]);
    const count = parseInt(res.rows[0].count, 10) + 1;
    return `${year}-${String(count).padStart(4, '0')}`;
};
exports.generateOrderNumber = generateOrderNumber;
//# sourceMappingURL=helpers.js.map
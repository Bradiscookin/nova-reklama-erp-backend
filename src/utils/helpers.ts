import { query } from '../db/pool';
import { JwtPayload } from '../middleware/auth';

export const logActivity = async (
  user: JwtPayload | undefined,
  action: string,
  entityType?: string,
  entityId?: string,
  ipAddress?: string
) => {
  try {
    await query(
      `INSERT INTO activity_logs (user_id, user_name, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user?.userId ?? null, user?.fullName ?? 'System', action, entityType ?? null, entityId ?? null, ipAddress ?? null]
    );
  } catch (err) {
    console.error('Failed to write activity log:', err);
  }
};

export const generateOrderNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const res = await query(
    `SELECT COUNT(*) FROM orders WHERE order_number LIKE $1`,
    [`${year}-%`]
  );
  const count = parseInt(res.rows[0].count, 10) + 1;
  return `${year}-${String(count).padStart(4, '0')}`;
};

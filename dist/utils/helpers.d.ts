import { JwtPayload } from '../middleware/auth';
export declare const logActivity: (user: JwtPayload | undefined, action: string, entityType?: string, entityId?: string, ipAddress?: string) => Promise<void>;
export declare const generateOrderNumber: () => Promise<string>;
//# sourceMappingURL=helpers.d.ts.map
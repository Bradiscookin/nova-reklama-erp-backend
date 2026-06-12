import { Request, Response, NextFunction } from 'express';
export interface JwtPayload {
    userId: string;
    username: string;
    role: string;
    fullName: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}
export declare const authenticate: (req: Request, res: Response, next: NextFunction) => void;
export declare const requireRole: (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => void;
export declare const requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
export declare const requireNotEmployee: (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.d.ts.map
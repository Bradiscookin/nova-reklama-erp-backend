"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const clients_1 = __importDefault(require("./routes/clients"));
const suppliers_1 = __importDefault(require("./routes/suppliers"));
const inventory_1 = __importDefault(require("./routes/inventory"));
const orders_1 = __importDefault(require("./routes/orders"));
const finance_1 = __importDefault(require("./routes/finance"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express_1.default.json({ limit: '2mb' }));
app.use((0, morgan_1.default)(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// Rate limiting — protects login and write endpoints from abuse
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', apiLimiter);
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' },
});
app.use('/api/auth/login', authLimiter);
// Static file uploads (production drawings, photos, attachments)
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), process.env.UPLOAD_DIR || './uploads')));
// Health check — used by hosting platforms & uptime monitors
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/clients', clients_1.default);
app.use('/api/suppliers', suppliers_1.default);
app.use('/api/inventory', inventory_1.default);
app.use('/api/orders', orders_1.default);
app.use('/api/finance', finance_1.default);
// 404 handler
app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});
// Global error handler — keeps the API alive on unexpected errors
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});
app.listen(PORT, () => {
    console.log(`🚀 NOVA REKLAMA ERP backend running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map
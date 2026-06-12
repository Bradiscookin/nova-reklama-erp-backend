"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pool_1 = require("./pool");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const migrate = async () => {
    console.log('🔄 Running migrations...');
    await (0, pool_1.query)(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    // ── ROLES & USERS ─────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS roles (
      id   SERIAL PRIMARY KEY,
      name VARCHAR(50) UNIQUE NOT NULL  -- admin | manager | employee
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS users (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      username     VARCHAR(80) UNIQUE NOT NULL,
      password_hash TEXT        NOT NULL,
      full_name    VARCHAR(120) NOT NULL,
      initials     VARCHAR(4)  NOT NULL,
      role_id      INTEGER     NOT NULL REFERENCES roles(id),
      is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── CLIENTS ───────────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS clients (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name         VARCHAR(200) NOT NULL,
      address      TEXT,
      notes        TEXT,
      outstanding_debt NUMERIC(14,2) NOT NULL DEFAULT 0,
      deleted_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS client_contacts (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id  UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      full_name  VARCHAR(120) NOT NULL,
      position   VARCHAR(100),
      phone      VARCHAR(40),
      telegram   VARCHAR(80),
      notes      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── SUPPLIERS ─────────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name           VARCHAR(200) NOT NULL,
      contact_person VARCHAR(120),
      phone          VARCHAR(40),
      notes          TEXT,
      deleted_at     TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── INVENTORY ─────────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS material_categories (
      id         SERIAL      PRIMARY KEY,
      name       VARCHAR(100) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS units (
      id         SERIAL      PRIMARY KEY,
      name       VARCHAR(60) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS materials (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      sku             VARCHAR(80) UNIQUE NOT NULL,
      name            VARCHAR(200) NOT NULL,
      category_id     INTEGER     REFERENCES material_categories(id),
      unit_id         INTEGER     REFERENCES units(id),
      quantity        NUMERIC(12,3) NOT NULL DEFAULT 0,
      reserved_qty    NUMERIC(12,3) NOT NULL DEFAULT 0,
      min_qty         NUMERIC(12,3) NOT NULL DEFAULT 0,
      purchase_price  NUMERIC(14,2) NOT NULL DEFAULT 0,
      supplier_id     UUID        REFERENCES suppliers(id),
      photo_url       TEXT,
      notes           TEXT,
      deleted_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS material_movements (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      material_id  UUID        NOT NULL REFERENCES materials(id),
      user_id      UUID        NOT NULL REFERENCES users(id),
      movement_type VARCHAR(30) NOT NULL,  -- stock_in | stock_out | reserve | unreserve | return | manual_correction
      quantity     NUMERIC(12,3) NOT NULL,
      qty_before   NUMERIC(12,3) NOT NULL,
      qty_after    NUMERIC(12,3) NOT NULL,
      order_id     UUID,                   -- FK added after orders table
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── ORDERS ────────────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS order_statuses (
      id    SERIAL      PRIMARY KEY,
      name  VARCHAR(50) UNIQUE NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS orders (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      order_number      VARCHAR(20) UNIQUE NOT NULL,
      client_id         UUID        REFERENCES clients(id),
      title             VARCHAR(300) NOT NULL,
      description       TEXT,
      amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
      currency          VARCHAR(5)  NOT NULL DEFAULT 'UZS',
      start_date        DATE,
      due_date          DATE,
      is_urgent         BOOLEAN     NOT NULL DEFAULT FALSE,
      status_id         INTEGER     NOT NULL REFERENCES order_statuses(id),
      installation_status VARCHAR(30) NOT NULL DEFAULT 'Pending',
      file_storage_path TEXT,
      deleted_at        TIMESTAMPTZ,
      created_by        UUID        REFERENCES users(id),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS order_materials (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      material_id UUID        NOT NULL REFERENCES materials(id),
      quantity    NUMERIC(12,3) NOT NULL,
      unit_id     INTEGER     REFERENCES units(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS order_employees (
      order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_note  VARCHAR(100),
      PRIMARY KEY (order_id, user_id)
    )
  `);
    // Add FK for material_movements -> orders (after orders table exists)
    await (0, pool_1.query)(`
    DO $$ BEGIN
      ALTER TABLE material_movements ADD CONSTRAINT fk_movement_order
        FOREIGN KEY (order_id) REFERENCES orders(id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
    // ── ATTACHMENTS ───────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS attachments (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id     UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      uploaded_by  UUID        REFERENCES users(id),
      original_name VARCHAR(300) NOT NULL,
      stored_name  VARCHAR(300) NOT NULL,
      mime_type    VARCHAR(100),
      size_bytes   BIGINT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── FINANCE ───────────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS payments (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id    UUID        REFERENCES orders(id),
      client_id   UUID        REFERENCES clients(id),
      amount      NUMERIC(14,2) NOT NULL,
      currency    VARCHAR(5)  NOT NULL DEFAULT 'UZS',
      payment_date DATE        NOT NULL DEFAULT CURRENT_DATE,
      description TEXT,
      recorded_by UUID        REFERENCES users(id),
      deleted_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS expenses (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      amount       NUMERIC(14,2) NOT NULL,
      currency     VARCHAR(5)  NOT NULL DEFAULT 'UZS',
      category     VARCHAR(100),
      description  TEXT,
      expense_date DATE        NOT NULL DEFAULT CURRENT_DATE,
      recorded_by  UUID        REFERENCES users(id),
      deleted_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        REFERENCES users(id) ON DELETE CASCADE,
      type       VARCHAR(50) NOT NULL,  -- low_stock | new_order | overdue | inventory_change
      title      VARCHAR(200) NOT NULL,
      body       TEXT,
      is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── ACTIVITY LOG ──────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        REFERENCES users(id),
      user_name   VARCHAR(120),
      action      VARCHAR(500) NOT NULL,
      entity_type VARCHAR(50),
      entity_id   UUID,
      ip_address  VARCHAR(45),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    // ── RECYCLE BIN ───────────────────────────────────────────────────────────
    await (0, pool_1.query)(`
    CREATE TABLE IF NOT EXISTS recycle_bin (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type  VARCHAR(50) NOT NULL,
      entity_id    UUID        NOT NULL,
      entity_label VARCHAR(300),
      deleted_by   UUID        REFERENCES users(id),
      deleted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
      snapshot     JSONB
    )
  `);
    // ── INDEXES ───────────────────────────────────────────────────────────────
    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_orders_client   ON orders(client_id)`,
        `CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status_id)`,
        `CREATE INDEX IF NOT EXISTS idx_orders_urgent   ON orders(is_urgent) WHERE is_urgent = TRUE`,
        `CREATE INDEX IF NOT EXISTS idx_orders_deleted  ON orders(deleted_at) WHERE deleted_at IS NULL`,
        `CREATE INDEX IF NOT EXISTS idx_materials_sku   ON materials(sku)`,
        `CREATE INDEX IF NOT EXISTS idx_materials_cat   ON materials(category_id)`,
        `CREATE INDEX IF NOT EXISTS idx_movements_mat   ON material_movements(material_id)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_user   ON activity_logs(user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_time   ON activity_logs(created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)`,
        `CREATE INDEX IF NOT EXISTS idx_recycle_expires ON recycle_bin(expires_at)`,
    ];
    for (const idx of indexes)
        await (0, pool_1.query)(idx);
    console.log('✅ Migrations complete.');
    process.exit(0);
};
migrate().catch((err) => { console.error('Migration failed:', err); process.exit(1); });
//# sourceMappingURL=migrate.js.map
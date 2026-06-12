import { query } from './pool';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const seed = async () => {
  console.log('🌱 Seeding database...');

  // Roles
  await query(`INSERT INTO roles (name) VALUES ('admin'),('manager'),('employee') ON CONFLICT DO NOTHING`);
  const roles = await query(`SELECT id, name FROM roles`);
  const roleMap: Record<string, number> = {};
  roles.rows.forEach((r: { id: number; name: string }) => (roleMap[r.name] = r.id));

  // Users
  const adminHash = await bcrypt.hash('NovaAdmin#2026', 12);
  const mgrHash   = await bcrypt.hash('NovaManager#2026', 12);
  const empHash   = await bcrypt.hash('NovaEmployee#2026', 12);
  await query(`
    INSERT INTO users (username, password_hash, full_name, initials, role_id) VALUES
      ('director', $1, 'Director',         'DR', $4),
      ('manager',  $2, 'Jasur Karimov',     'JK', $5),
      ('aziz',     $3, 'Aziz Toshmatov',    'AT', $6)
    ON CONFLICT (username) DO NOTHING
  `, [adminHash, mgrHash, empHash, roleMap.admin, roleMap.manager, roleMap.employee]);

  // Material categories
  const cats = ['PVC','Acrylic','Composite','Oracal','Metal','LED','Paint','Consumables'];
  for (const c of cats) await query(`INSERT INTO material_categories (name) VALUES ($1) ON CONFLICT DO NOTHING`, [c]);

  // Units
  const units = ['Piece','Sheet','Meter','Square Meter','Roll','Kilogram','Liter','Set'];
  for (const u of units) await query(`INSERT INTO units (name) VALUES ($1) ON CONFLICT DO NOTHING`, [u]);

  const catRows  = await query(`SELECT id, name FROM material_categories`);
  const unitRows = await query(`SELECT id, name FROM units`);
  const catMap: Record<string, number>  = {};
  const unitMap: Record<string, number> = {};
  catRows.rows.forEach((r: {id:number;name:string}) => (catMap[r.name] = r.id));
  unitRows.rows.forEach((r: {id:number;name:string}) => (unitMap[r.name] = r.id));

  // Suppliers
  await query(`
    INSERT INTO suppliers (name, contact_person, phone, notes) VALUES
      ('Oracal Uzbekistan',    'Timur Nazarov',    '+998901010101', 'Main vinyl supplier'),
      ('PrintMaster Supplies', 'Gulnora Hamidova', '+998912020202', 'Inks & consumables'),
      ('MetalCraft Co',        'Sardor Mirzaev',   '+998923030303', 'Metal profiles & frames')
    ON CONFLICT DO NOTHING
  `);
  const suppRows = await query(`SELECT id, name FROM suppliers`);
  const suppMap: Record<string, string> = {};
  suppRows.rows.forEach((r: {id:string;name:string}) => (suppMap[r.name] = r.id));

  // Materials
  const materials = [
    { sku:'PVC-3MM-001', name:'PVC Sheet 3mm',       cat:'PVC',         unit:'Sheet',  qty:45,  res:5,  min:10, price:85000,  supp:'PrintMaster Supplies' },
    { sku:'ORC-WHT-001', name:'Oracal White 1.06m',  cat:'Oracal',      unit:'Meter',  qty:120, res:20, min:30, price:12000,  supp:'Oracal Uzbekistan' },
    { sku:'ACR-4MM-001', name:'Acrylic 4mm Clear',   cat:'Acrylic',     unit:'Sheet',  qty:8,   res:2,  min:15, price:150000, supp:'PrintMaster Supplies' },
    { sku:'LED-MOD-001', name:'LED Module 12V',       cat:'LED',         unit:'Piece',  qty:200, res:30, min:50, price:8500,   supp:'MetalCraft Co' },
    { sku:'INK-BLK-001', name:'Black Ink 1L',         cat:'Consumables', unit:'Liter',  qty:6,   res:0,  min:10, price:45000,  supp:'PrintMaster Supplies' },
    { sku:'ALU-PRF-001', name:'Aluminium Profile 3m', cat:'Metal',       unit:'Meter',  qty:60,  res:10, min:20, price:25000,  supp:'MetalCraft Co' },
  ];
  for (const m of materials) {
    await query(`
      INSERT INTO materials (sku, name, category_id, unit_id, quantity, reserved_qty, min_qty, purchase_price, supplier_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (sku) DO NOTHING
    `, [m.sku, m.name, catMap[m.cat], unitMap[m.unit], m.qty, m.res, m.min, m.price, suppMap[m.supp]]);
  }

  // Clients
  await query(`
    INSERT INTO clients (name, address, notes, outstanding_debt) VALUES
      ('Tashkent City Reklama', 'Yunusobod, Tashkent',         'VIP client',    1500000),
      ('Global Advertising Ltd','Chilanzar, Tashkent',          '',              0),
      ('BrandPro Agency',       'Mirzo-Ulugbek, Tashkent',     'Pays on time',  850000)
    ON CONFLICT DO NOTHING
  `);
  const clientRows = await query(`SELECT id, name FROM clients`);
  const clientMap: Record<string, string> = {};
  clientRows.rows.forEach((r: {id:string;name:string}) => (clientMap[r.name] = r.id));

  // Client contacts
  await query(`INSERT INTO client_contacts (client_id, full_name, position, phone, telegram) VALUES
    ($1, 'Mirzo Aliyev',      'Director', '+998901234567', '@mirzo'),
    ($2, 'Nilufar Rashidova', 'Manager',  '+998911112233', ''),
    ($3, 'Bobur Yusupov',     'CEO',      '+998932223344', '@bobur')
    ON CONFLICT DO NOTHING
  `, [clientMap['Tashkent City Reklama'], clientMap['Global Advertising Ltd'], clientMap['BrandPro Agency']]);

  // Order statuses
  const statuses = [['New',1],['Approval',2],['Production',3],['Installation',4],['Completed',5],['Closed',6],['Cancelled',7]];
  for (const [name, sort] of statuses) {
    await query(`INSERT INTO order_statuses (name, sort_order) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`, [name, sort]);
  }
  const statusRows = await query(`SELECT id, name FROM order_statuses`);
  const statusMap: Record<string, number> = {};
  statusRows.rows.forEach((r: {id:number;name:string}) => (statusMap[r.name] = r.id));

  const userRows = await query(`SELECT id, username FROM users`);
  const userMap: Record<string, string> = {};
  userRows.rows.forEach((r: {id:string;username:string}) => (userMap[r.username] = r.id));

  // Orders
  await query(`
    INSERT INTO orders (order_number, client_id, title, description, amount, currency, start_date, due_date, is_urgent, status_id, installation_status, file_storage_path, created_by)
    VALUES
      ('2026-0001', $1, 'Outdoor Billboard 6x3m',  'Double-sided backlit billboard', 4500000, 'UZS', '2026-06-01', '2026-06-15', TRUE,  $5, 'Assigned', 'D:\\NOVA\\2026\\Order_001\\', $9),
      ('2026-0002', $2, 'Shop Signage Package',     '3 signs with logo',              1200000, 'UZS', '2026-06-05', '2026-06-20', FALSE, $6, 'Pending',  '', $9),
      ('2026-0003', $3, 'Trade Show Display',       'Modular display system',         850,     'USD', '2026-06-08', '2026-06-25', TRUE,  $7, 'Pending',  '', $10),
      ('2026-0004', $1, 'Vehicle Wrap',             'Full wrap sedan',                2200000, 'UZS', '2026-05-20', '2026-06-10', FALSE, $8, 'Completed','', $9)
    ON CONFLICT (order_number) DO NOTHING
  `, [
    clientMap['Tashkent City Reklama'], clientMap['Global Advertising Ltd'],
    clientMap['BrandPro Agency'], clientMap['Tashkent City Reklama'],
    statusMap['Production'], statusMap['Approval'], statusMap['New'], statusMap['Completed'],
    userMap['director'], userMap['aziz'],
  ]);

  // Finance seed
  await query(`
    INSERT INTO payments (client_id, amount, currency, payment_date, description, recorded_by)
    VALUES
      ($1, 4500000, 'UZS', '2026-06-10', 'Payment - Order 2026-0001', $3),
      ($2, 500,     'USD', '2026-06-09', 'Partial payment - Order 2026-0003', $3)
    ON CONFLICT DO NOTHING
  `, [clientMap['Tashkent City Reklama'], clientMap['BrandPro Agency'], userMap['director']]);

  await query(`
    INSERT INTO expenses (amount, currency, category, description, expense_date, recorded_by)
    VALUES
      (850000, 'UZS', 'Materials', 'Ink & materials purchase',  '2026-06-08', $1),
      (320000, 'UZS', 'Utilities', 'Electricity & utilities',   '2026-06-01', $1)
    ON CONFLICT DO NOTHING
  `, [userMap['director']]);

  // Activity log
  await query(`
    INSERT INTO activity_logs (user_name, action, entity_type) VALUES
      ('Admin User',       'System initialized — NOVA REKLAMA ERP', 'system'),
      ('Admin User',       'Created Order 2026-0001', 'order'),
      ('Aziz Toshmatov',   'Changed status to Production (Order 2026-0001)', 'order'),
      ('Jasur Karimov',    'Added client: BrandPro Agency', 'client'),
      ('Admin User',       'Deducted 20 LED Module from inventory', 'material')
    ON CONFLICT DO NOTHING
  `);

  console.log('✅ Seed complete.');
  process.exit(0);
};

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });

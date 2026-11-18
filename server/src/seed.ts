import { pool, tx } from './db.js';
import { config } from './config.js';
import { hashPassword, passwordProblem, slugify } from './lib/security.js';
import { DEFAULT_SETTINGS } from './lib/settings.js';

const CATEGORIES: [string, string, string[]][] = [
  ['Electronics', 'cpu', ['TVs & Audio', 'Cameras', 'Gaming', 'Accessories']],
  ['Mobile Phones', 'smartphone', ['Smartphones', 'Tablets', 'Phone Accessories']],
  ['Computers', 'laptop', ['Laptops', 'Desktops', 'Monitors', 'Components']],
  ['Home Appliances', 'refrigerator', ['Refrigerators', 'Washing Machines', 'Air Conditioners', 'Kitchen Appliances']],
  ['Vehicles', 'car', ['Cars', 'Motorcycles', 'Spare Parts']],
  ['Property', 'home', ['For Sale', 'For Rent', 'Plots']],
  ['Furniture', 'sofa', ['Living Room', 'Bedroom', 'Office']],
  ['Fashion', 'shirt', ["Men's", "Women's", 'Kids', 'Watches & Jewellery']],
  ['Sports', 'dumbbell', ['Fitness', 'Cycling', 'Outdoor']],
  ['Services', 'wrench', ['Repairs', 'Home Services', 'Tuition']],
  ['Other', 'package', []],
];

const PLANS = [
  { name: 'Single Listing', kind: 'single', description: 'Post one listing for 30 days.', price: 4.99, listing_limit: 1, max_active: 1, days: 30, featured: false, quota: 0 },
  { name: 'Monthly Seller', kind: 'monthly', description: 'Up to 15 listings a month.', price: 19.99, listing_limit: 15, max_active: 10, days: 30, featured: true, quota: 1 },
  { name: 'Quarterly Seller', kind: 'quarterly', description: 'Up to 50 listings over 3 months.', price: 49.99, listing_limit: 50, max_active: 25, days: 90, featured: true, quota: 4 },
  { name: 'Annual Seller', kind: 'annual', description: 'Up to 250 listings over a year.', price: 179, listing_limit: 250, max_active: 60, days: 365, featured: true, quota: 20 },
];

export async function seed(log = console.log) {
  await tx(async (c) => {
    await c.query(`INSERT INTO roles (name, description) VALUES
      ('user','Registered member'),('admin','Platform administrator'),('system','Automated system actor')
      ON CONFLICT DO NOTHING`);
    await c.query(`INSERT INTO permissions (code, description) VALUES
      ('listing.create','Create and manage own listings (granted with an active seller plan)'),
      ('listing.feature','Mark own listings as featured within plan quota'),
      ('chat.initiate','Start conversations with sellers (granted on account approval)'),
      ('admin.all','Full administrative access')
      ON CONFLICT DO NOTHING`);
    await c.query(`INSERT INTO role_permissions VALUES ('admin','admin.all') ON CONFLICT DO NOTHING`);

    // System actor used to record gateway-verified payments; it can never log in.
    await c.query(`INSERT INTO users (id, email, password_hash, role, status, email_verified_at, terms_accepted_at)
      VALUES ('00000000-0000-0000-0000-000000000001','system@internal.invalid','!disabled','system','approved',now(),now())
      ON CONFLICT DO NOTHING`);

    const { rows: catCount } = await c.query('SELECT count(*)::int AS n FROM categories');
    if (catCount[0].n === 0) {
      let i = 0;
      for (const [name, icon, subs] of CATEGORIES) {
        const { rows } = await c.query(
          'INSERT INTO categories (name, slug, icon, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
          [name, slugify(name), icon, i++],
        );
        let j = 0;
        for (const s of subs) {
          await c.query('INSERT INTO subcategories (category_id, name, slug, sort_order) VALUES ($1,$2,$3,$4)', [rows[0].id, s, slugify(s), j++]);
        }
      }
      log(`seeded ${CATEGORIES.length} categories`);
    }

    const { rows: planCount } = await c.query('SELECT count(*)::int AS n FROM seller_plans');
    if (planCount[0].n === 0) {
      let i = 0;
      for (const p of PLANS) {
        await c.query(
          `INSERT INTO seller_plans (name, kind, description, price, currency, listing_limit, max_active_listings, duration_days, featured_allowed, featured_quota, sort_order)
           VALUES ($1,$2,$3,$4,'CAD',$5,$6,$7,$8,$9,$10)`,
          [p.name, p.kind, p.description, p.price, p.listing_limit, p.max_active, p.days, p.featured, p.quota, i++],
        );
      }
      log(`seeded ${PLANS.length} seller plans`);
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await c.query('INSERT INTO website_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(value)]);
    }

    if (config.admin.email && config.admin.password) {
      const problem = passwordProblem(config.admin.password);
      if (problem) throw new Error(`ADMIN_PASSWORD: ${problem}`);
      const { rows } = await c.query('SELECT id FROM users WHERE lower(email)=lower($1)', [config.admin.email]);
      if (rows.length === 0) {
        const hash = await hashPassword(config.admin.password);
        const { rows: u } = await c.query(
          `INSERT INTO users (email, password_hash, role, status, email_verified_at, approved_at, terms_accepted_at)
           VALUES ($1,$2,'admin','approved',now(),now(),now()) RETURNING id`,
          [config.admin.email, hash],
        );
        await c.query('INSERT INTO user_profiles (user_id, full_name, phone) VALUES ($1,$2,$3)', [u[0].id, config.admin.name, '']);
        await c.query(`INSERT INTO activity_logs (actor_id, action, target_type, target_id) VALUES (NULL,'admin.bootstrap','user',$1)`, [u[0].id]);
        log(`created admin account ${config.admin.email}`);
      }
    } else {
      log('ADMIN_EMAIL / ADMIN_PASSWORD not set — no admin account created');
    }
  });
}

// Run only when invoked directly (`npm run seed` / `node dist/seed.js`), never when bundled into the server.
if (/seed\.(ts|js)$/.test(process.argv[1] ?? '')) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}

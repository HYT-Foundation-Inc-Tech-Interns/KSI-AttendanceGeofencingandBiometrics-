/*
 * Repair: align every employee-linked login with the employee it points at.
 *
 * Background
 * ----------
 * `EmployeesService.update()` used to write only the `employees` row. Editing
 * an employee's name or email therefore left the linked `users` row holding
 * whatever it was created with, so the login said one person and the dashboard
 * (which reads the employee) said another. The service now syncs the account on
 * every update, so this cannot happen again -- but rows diverged before that
 * fix are still wrong, and this puts them right.
 *
 * It is idempotent and safe to re-run: a row that already agrees is left
 * alone, and rows are only ever changed to match their own employee.
 *
 * Usage, from the backend/ directory:
 *   node scripts/sync-employee-accounts.mjs --dry-run   # show what would change
 *   node scripts/sync-employee-accounts.mjs             # apply
 */

import 'dotenv/config';
import pg from 'pg';

const dryRun = process.argv.includes('--dry-run');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// Only employee-linked accounts. Admin/HR/supervisor logins have no employee
// record and are deliberately out of scope.
const { rows: drifted } = await client.query(`
  select u.id, u.email as user_email, u.full_name as user_name,
         e.id as employee_id, e.email as employee_email, e.full_name as employee_name,
         e.employee_code
  from users u
  join employees e on e.id = u.employee_id
  where u.email is distinct from e.email
     or u.full_name is distinct from e.full_name
  order by e.employee_code
`);

if (drifted.length === 0) {
  console.log('Nothing to repair: every employee-linked login already matches.');
  await client.end();
  process.exit(0);
}

console.log(
  `${drifted.length} account(s) out of step with their employee record:\n`,
);

for (const row of drifted) {
  console.log(`  ${row.employee_code}`);
  console.log(`    email: ${row.user_email}  ->  ${row.employee_email}`);
  console.log(`    name:  ${row.user_name}  ->  ${row.employee_name}`);
}

// `users.email` is globally unique. Two employee-linked accounts aiming at the
// same address would collide here, and the update would abort halfway through
// with a raw 23505, so the conflict is detected and reported before anything is
// written.
const { rows: clashes } = await client.query(`
  select e.email, array_agg(e.employee_code) as codes
  from employees e
  join users u on u.employee_id = e.id
  where e.email is not null
  group by e.email
  having count(*) > 1
`);

// Employees with a null email have nothing to sync to, so they are excluded
// rather than allowed to null out a working login.
const targetEmails = drifted
  .map((r) => r.employee_email)
  .filter((email) => email !== null);

const { rows: taken } = targetEmails.length
  ? await client.query(
      `select email from users where email = any($1) and employee_id is null`,
      [targetEmails],
    )
  : { rows: [] };
if (taken.length > 0 || clashes.length > 0) {
  console.error('\nRefusing to continue -- these addresses are not free:');
  for (const t of taken) {
    console.error(`  ${t.email} is already used by a non-employee account`);
  }
  for (const c of clashes) {
    console.error(`  ${c.email} is shared by employees ${c.codes.join(', ')}`);
  }
  console.error('Resolve these by hand, then re-run.');
  await client.end();
  process.exit(1);
}

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  await client.end();
  process.exit(0);
}

await client.query('begin');
try {
  for (const row of drifted) {
    await client.query(
      `update users set email = $1, full_name = $2, updated_at = now() where id = $3`,
      [row.employee_email, row.employee_name, row.id],
    );
  }
  await client.query('commit');
  console.log(`\nRepaired ${drifted.length} account(s).`);
} catch (error) {
  await client.query('rollback');
  console.error('\nFailed, rolled back. Nothing was changed.');
  console.error(error.message);
  await client.end();
  process.exit(1);
}

// Confirm the write landed rather than trusting the commit alone.
const { rows: remaining } = await client.query(`
  select count(*)::int as n
  from users u join employees e on e.id = u.employee_id
  where u.email is distinct from e.email or u.full_name is distinct from e.full_name
`);
console.log(`Verification: ${remaining[0].n} drifted account(s) remaining.`);

await client.end();

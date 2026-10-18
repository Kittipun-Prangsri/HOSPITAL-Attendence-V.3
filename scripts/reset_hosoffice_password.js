require('dotenv').config();
const bcrypt = require('bcryptjs');
const { hosofficePool, STAFF } = require('../src/config/db');
const { saveAccount } = require('../src/services/staffStore');

async function resetPassword() {
  const username = process.argv[2];
  const password = process.env.NEW_PASSWORD;
  if (!username || !password) {
    throw new Error('Usage: NEW_PASSWORD="a-strong-password" npm run reset-password -- <HR_CID>');
  }
  if (password.length < 8) {
    throw new Error('NEW_PASSWORD must be at least 8 characters long');
  }

  const hash = await bcrypt.hash(password, 12);
  // Stored in hospital_db.app_accounts (HOSoffice hr_person is never written)
  const [rows] = await hosofficePool.query(`SELECT ID FROM ${STAFF} WHERE HR_CID = ?`, [username]);
  if (rows.length !== 1) throw new Error('User not found (HR_CID must exist in HOSoffice hr_person)');
  await saveAccount(rows[0].ID, { passwordHash: hash }, 'reset-password script');
  console.log(`Password updated for ${username}.`);
}

resetPassword()
  .then(() => process.exit(0))
  .catch(error => { console.error(`[reset-password] ${error.message}`); process.exit(1); });

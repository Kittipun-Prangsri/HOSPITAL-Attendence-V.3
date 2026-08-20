require('dotenv').config();
const bcrypt = require('bcryptjs');
const { hosofficePool } = require('../src/config/db');

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
  const [result] = await hosofficePool.query(
    'UPDATE hr_person SET HR_PASSWORD_HASH = ? WHERE HR_CID = ?',
    [hash, username]
  );
  if (result.affectedRows !== 1) throw new Error('User not found or password was not updated');
  console.log(`Password updated for ${username}.`);
}

resetPassword()
  .then(() => process.exit(0))
  .catch(error => { console.error(`[reset-password] ${error.message}`); process.exit(1); });

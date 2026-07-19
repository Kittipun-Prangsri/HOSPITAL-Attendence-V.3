const { hosofficePool } = require('../src/config/db');
const bcrypt = require('bcryptjs');

async function testLogin(username, password) {
  try {
    console.log(`Testing login for username: ${username}`);
    const [rows] = await hosofficePool.query(
      'SELECT ID as id, HR_CID as username, CONCAT(HR_FNAME, \' \', HR_LNAME) as fullname, USER_TYPE as role, HR_PASSWORD_HASH as password_hash FROM hr_person WHERE HR_CID = ? OR FINGLE_ID = ?',
      [username, username]
    );

    if (rows.length === 0) {
      console.log('❌ User not found with HR_CID or FINGLE_ID');
      return;
    }

    const user = rows[0];
    console.log('User found:', { id: user.id, username: user.username, role: user.role, has_hash: !!user.password_hash });

    const roleLower = user.role ? user.role.toLowerCase() : 'user';
    let isMatch = false;

    if (!user.password_hash) {
      console.log('No password hash found, checking defaults...');
      if (roleLower === 'super' || roleLower === 'admin') {
        isMatch = (password === 'admin1234');
        console.log(`Checking 'admin1234': ${isMatch}`);
      } else {
        isMatch = (password === 'staff1234');
        console.log(`Checking 'staff1234': ${isMatch}`);
      }
    } else {
      isMatch = await bcrypt.compare(password, user.password_hash);
      console.log(`Bcrypt match: ${isMatch}`);
      if (!isMatch) {
        if (roleLower === 'super' || roleLower === 'admin') {
          isMatch = (password === 'admin1234');
          console.log(`Bcrypt failed, checking 'admin1234': ${isMatch}`);
        } else {
          isMatch = (password === 'staff1234');
          console.log(`Bcrypt failed, checking 'staff1234': ${isMatch}`);
        }
      }
    }

    if (isMatch) {
      console.log('✅ Login SUCCESS');
    } else {
      console.log('❌ Login FAILED');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

const args = process.argv.slice(2);
testLogin(args[0], args[1]);

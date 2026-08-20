const { hosofficePool } = require('../src/config/db');
const bcrypt = require('bcryptjs');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

const ok = (msg) => console.log(`  ${GREEN}✔${RESET} ${msg}`);
const bad = (msg) => console.log(`  ${RED}✘${RESET} ${msg}`);
const info = (msg) => console.log(`  ${DIM}·${RESET} ${msg}`);

function section(title) {
  const width = 48;
  const label = ` ${title} `;
  const padLeft = Math.floor((width - label.length) / 2);
  const padRight = width - label.length - padLeft;
  console.log(`\n${CYAN}╭${'─'.repeat(width)}╮${RESET}`);
  console.log(`${CYAN}│${RESET}${'─'.repeat(padLeft)}${BOLD}${label}${RESET}${'─'.repeat(padRight)}${CYAN}│${RESET}`);
  console.log(`${CYAN}╰${'─'.repeat(width)}╯${RESET}`);
}

function verdict(isMatch) {
  const width = 48;
  const label = isMatch ? '✅  LOGIN SUCCESS' : '❌  LOGIN FAILED';
  const color = isMatch ? GREEN : RED;
  console.log(`\n${color}${'═'.repeat(width)}${RESET}`);
  console.log(`${color}${BOLD}${label.padStart((width + label.length) / 2)}${RESET}`);
  console.log(`${color}${'═'.repeat(width)}${RESET}\n`);
}

async function testLogin(username, password) {
  section('🔐 Login Test');
  info(`username: ${BOLD}${username}${RESET}`);

  try {
    const [rows] = await hosofficePool.query(
      'SELECT ID as id, HR_CID as username, CONCAT(HR_FNAME, \' \', HR_LNAME) as fullname, USER_TYPE as role, HR_PASSWORD_HASH as password_hash FROM hr_person WHERE HR_CID = ? OR FINGLE_ID = ?',
      [username, username]
    );

    if (rows.length === 0) {
      bad('User not found with HR_CID or FINGLE_ID');
      verdict(false);
      return;
    }

    const user = rows[0];
    ok(`User found: ${BOLD}${user.fullname}${RESET}`);
    info(`id: ${user.id}  role: ${user.role || 'user'}  has_hash: ${!!user.password_hash}`);

    const roleLower = user.role ? user.role.toLowerCase() : 'user';
    const defaultPassword = (roleLower === 'super' || roleLower === 'admin') ? 'admin1234' : 'staff1234';
    let isMatch = false;

    if (!user.password_hash) {
      console.log(`\n  ${YELLOW}No password hash found, checking default password...${RESET}`);
      isMatch = (password === defaultPassword);
      (isMatch ? ok : bad)(`checking '${defaultPassword}': ${isMatch}`);
    } else {
      isMatch = await bcrypt.compare(password, user.password_hash);
      (isMatch ? ok : bad)(`bcrypt match: ${isMatch}`);
      if (!isMatch) {
        isMatch = (password === defaultPassword);
        (isMatch ? ok : bad)(`bcrypt failed, checking '${defaultPassword}': ${isMatch}`);
      }
    }

    verdict(isMatch);
  } catch (err) {
    console.error(`\n  ${RED}${BOLD}Error:${RESET}`, err);
  } finally {
    process.exit(0);
  }
}

const args = process.argv.slice(2);
testLogin(args[0], args[1]);

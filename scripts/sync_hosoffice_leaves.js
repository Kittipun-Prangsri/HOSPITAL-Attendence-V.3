require('dotenv').config();
const { syncLeavesFromHosoffice } = require('../src/services/hosofficeLeaveSync');

async function main() {
  const fromDate = process.argv[2] || `${new Date().getFullYear()}-01-01`;
  console.log(`[sync-leaves] Starting leave sync from HOSoffice since ${fromDate}...`);
  const result = await syncLeavesFromHosoffice({ fromDate });
  console.log(`[sync-leaves] Successfully synced ${result.synced} leaves across months: ${result.months.join(', ')}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`[sync-leaves] Error: ${err.message}`);
    process.exit(1);
  });

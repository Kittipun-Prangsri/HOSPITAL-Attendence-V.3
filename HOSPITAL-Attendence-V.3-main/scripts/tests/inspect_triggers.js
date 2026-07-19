const { hosofficePool } = require('../../src/config/db');

async function inspectTriggers() {
  try {
    console.log('--- SHOW CREATE TABLE hikvision ---');
    const [createTable] = await hosofficePool.query('SHOW CREATE TABLE hikvision');
    console.log(createTable[0]['Create Table']);

    console.log('--- SHOW TRIGGERS LIKE hikvision ---');
    const [triggers] = await hosofficePool.query('SHOW TRIGGERS LIKE \'hikvision\'');
    console.table(triggers);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

inspectTriggers();

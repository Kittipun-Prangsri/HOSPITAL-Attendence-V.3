const { hosofficePool } = require('../src/config/db');

async function checkColumns() {
  try {
    console.log('--- Checking columns in hr_person ---');
    const [columns] = await hosofficePool.query("SHOW COLUMNS FROM hr_person");
    const columnNames = columns.map(c => c.Field);
    
    const targetColumns = ['WORK_SHIFT', 'TIME_IN', 'TIME_OUT'];
    const missing = targetColumns.filter(col => !columnNames.includes(col));
    const existing = targetColumns.filter(col => columnNames.includes(col));

    console.log('Existing columns:', existing);
    console.log('Missing columns:', missing);

    if (missing.length > 0) {
      console.log('\n--- SQL to run ---');
      const sql = `ALTER TABLE hr_person \n${missing.map(col => `ADD COLUMN ${col} ${col === 'WORK_SHIFT' ? 'VARCHAR(50)' : 'VARCHAR(10)'} NULL`).join(',\n')};`;
      console.log(sql);
    } else {
      console.log('\nAll target columns exist.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
}

checkColumns();

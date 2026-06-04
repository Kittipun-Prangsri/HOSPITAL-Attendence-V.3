const { pool, hosofficePool } = require('../../src/config/db');
const excuseController = require('../../src/controllers/excuseController');

async function testGetExcuses() {
  console.log('Testing getExcuses...');
  const req = {
    session: {
      user: {
        role: 'admin',
        username: 'admin'
      }
    }
  };
  
  const res = {
    json: function(data) {
      console.log('Result success:', data.success);
      if (data.success && data.excuses) {
        console.log(`Retrieved ${data.excuses.length} excuses.`);
        data.excuses.slice(0, 5).forEach((ex, i) => {
          console.log(`[${i+1}] Username: ${ex.username}, Fullname: "${ex.fullname}"`);
        });
      } else {
        console.log('Error or no excuses data:', data);
      }
    },
    status: function(code) {
      console.log('Status code:', code);
      return this;
    }
  };

  try {
    await excuseController.getExcuses(req, res);
  } catch (err) {
    console.error('Test execution failed:', err);
  }
}

async function testCompileReminders() {
  console.log('\nTesting compileReminderCandidates...');
  try {
    const list = await excuseController.compileReminderCandidates();
    console.log(`Retrieved ${list.length} reminder candidates.`);
    list.slice(0, 5).forEach((r, i) => {
      console.log(`[${i+1}] Username: ${r.username}, Fullname: "${r.fullname}"`);
    });
  } catch (err) {
    console.error('Reminder compilation test failed:', err);
  }
}

async function run() {
  await testGetExcuses();
  await testCompileReminders();
  process.exit(0);
}

run();

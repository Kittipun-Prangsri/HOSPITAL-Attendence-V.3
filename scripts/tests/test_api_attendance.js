const http = require('http');

const data = JSON.stringify({
  employeeId: 'KHH00108',
  status: 'check-in',
  deviceName: 'KHHin2'
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/attendance',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log('Sending POST request to http://localhost:3001/api/attendance...');

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log(`Response Status: ${res.statusCode}`);
    console.log(`Response Body: ${responseData}`);
    if (res.statusCode === 200) {
      console.log('🎉 SUCCESS! The API received the check-in, saved to DB, and sent notifications.');
    } else {
      console.error('❌ FAILED: Server returned an error.');
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request Error:', error.message);
});

req.write(data);
req.end();

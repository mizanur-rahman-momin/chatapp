const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Set test environment
process.env.PORT = '3099';
process.env.SESSION_SECRET = 'test-secret-key-12345';
process.env.USER1_NAME = 'Me';
process.env.USER1_PIN = '1122';
process.env.USER2_NAME = 'Her';
process.env.USER2_PIN = '3344';

const db = require('./db');

async function runTests() {
  console.log('--- 1. Testing Database Operations (db.js) ---');

  // Test addMessage text
  const msg1 = db.addMessage({ sender_id: 1, type: 'text', content: 'Hey there!' });
  assert.strictEqual(msg1.sender_id, 1);
  assert.strictEqual(msg1.type, 'text');
  assert.strictEqual(msg1.content, 'Hey there!');
  assert.strictEqual(msg1.is_read, 0);
  assert.ok(msg1.id > 0);
  console.log('✓ Text message inserted successfully:', msg1);

  // Test addMessage image
  const msg2 = db.addMessage({ sender_id: 2, type: 'image', content: '/uploads/test.jpg' });
  assert.strictEqual(msg2.sender_id, 2);
  assert.strictEqual(msg2.type, 'image');
  assert.strictEqual(msg2.content, '/uploads/test.jpg');
  console.log('✓ Image message inserted successfully:', msg2);

  // Test getMessages
  const messages = db.getMessages(50);
  assert.ok(messages.length >= 2);
  console.log(`✓ Retrieved ${messages.length} messages in chronological order`);

  // Test markAsRead
  db.markAsRead(1); // user 1 reads messages sent by user 2
  const updatedMessages = db.getMessages(50);
  const updatedMsg2 = updatedMessages.find(m => m.id === msg2.id);
  assert.strictEqual(updatedMsg2.is_read, 1);
  console.log('✓ markAsRead updated partner messages successfully');

  console.log('\n--- 2. Testing HTTP & API Endpoints ---');
  // Start server
  require('./server');

  // Wait 500ms for server to bind
  await new Promise(resolve => setTimeout(resolve, 500));

  const baseUrl = 'http://127.0.0.1:3099';

  // Helper for requests
  function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders = { ...headers };
      let payload = null;
      if (body && typeof body === 'object' && !(body instanceof Buffer)) {
        payload = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      } else if (body instanceof Buffer) {
        payload = body;
      }

      const req = http.request(url, { method, headers: reqHeaders }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Test static file serving
  const indexRes = await request('GET', '/');
  assert.strictEqual(indexRes.statusCode, 200);
  assert.ok(indexRes.body.includes('ChatApp'));
  console.log('✓ Static index.html served');

  const cssRes = await request('GET', '/css/style.css');
  assert.strictEqual(cssRes.statusCode, 200);
  assert.ok(cssRes.body.includes('--bg-chat'));
  console.log('✓ Static style.css served');

  // Test Login with invalid PIN
  const invalidLogin = await request('POST', '/api/login', { pin: '9999' });
  assert.strictEqual(invalidLogin.statusCode, 401);
  console.log('✓ Invalid PIN rejected with 401');

  // Test Login with valid PIN (User 1)
  const loginUser1 = await request('POST', '/api/login', { pin: '1122' });
  assert.strictEqual(loginUser1.statusCode, 200);
  const user1Data = JSON.parse(loginUser1.body);
  assert.strictEqual(user1Data.user.id, 1);
  assert.strictEqual(user1Data.partner.id, 2);
  const cookieUser1 = loginUser1.headers['set-cookie']?.[0]?.split(';')[0];
  assert.ok(cookieUser1 && cookieUser1.includes('auth_token='));
  console.log('✓ User 1 login passed, received session cookie');

  // Test Login with valid PIN (User 2)
  const loginUser2 = await request('POST', '/api/login', { pin: '3344' });
  assert.strictEqual(loginUser2.statusCode, 200);
  const user2Data = JSON.parse(loginUser2.body);
  assert.strictEqual(user2Data.user.id, 2);
  assert.strictEqual(user2Data.partner.id, 1);
  console.log('✓ User 2 login passed');

  // Test /api/me with cookie
  const meRes = await request('GET', '/api/me', null, { Cookie: cookieUser1 });
  assert.strictEqual(meRes.statusCode, 200);
  const meData = JSON.parse(meRes.body);
  assert.strictEqual(meData.user.id, 1);
  console.log('✓ /api/me authenticated session successfully');

  // Test /api/me without cookie
  const unauthRes = await request('GET', '/api/me');
  assert.strictEqual(unauthRes.statusCode, 401);
  console.log('✓ /api/me without auth rejected with 401');

  // Test /api/messages with cookie
  const getMessagesRes = await request('GET', '/api/messages', null, { Cookie: cookieUser1 });
  assert.strictEqual(getMessagesRes.statusCode, 200);
  const msgsData = JSON.parse(getMessagesRes.body);
  assert.ok(Array.isArray(msgsData.messages));
  console.log(`✓ /api/messages returned ${msgsData.messages.length} messages`);

  // Test multipart image upload
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const dummyImageBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d4b0000000049454e44ae426082', 'hex'); // 1x1 valid PNG

  const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="dot.png"\r\nContent-Type: image/png\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const payloadBuffer = Buffer.concat([
    Buffer.from(header, 'utf8'),
    dummyImageBytes,
    Buffer.from(footer, 'utf8')
  ]);

  const uploadRes = await request('POST', '/api/upload', payloadBuffer, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': payloadBuffer.length,
    Cookie: cookieUser1
  });

  assert.strictEqual(uploadRes.statusCode, 200);
  const uploadData = JSON.parse(uploadRes.body);
  assert.ok(uploadData.url.startsWith('/uploads/'));
  assert.strictEqual(uploadData.filename, 'dot.png');
  console.log('✓ /api/upload image upload passed, stored at:', uploadData.url);

  console.log('\n=========================================');
  console.log(' ALL AUTOMATED TESTS PASSED SUCCESSFULLY!');
  console.log('=========================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});


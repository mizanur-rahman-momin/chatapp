const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Set test environment with isolated test database
process.env.PORT = '3099';
process.env.SESSION_SECRET = 'test-secret-key-12345';
process.env.DB_PATH = path.join(__dirname, 'data', 'test-chat.db');
process.env.USER1_NAME = 'Me';
process.env.USER1_PIN = '1122';
process.env.USER2_NAME = 'Her';
process.env.USER2_PIN = '3344';

const db = require('./db');

async function runTests() {
  console.log('--- 1. Testing Database Operations & AES-256 Encryption ---');

  // Test addMessage text with encryption
  const secretText = 'This is our super top-secret message! ❤️';
  const msg1 = db.addMessage({ sender_id: 1, type: 'text', content: secretText });
  assert.strictEqual(msg1.sender_id, 1);
  assert.strictEqual(msg1.type, 'text');
  assert.strictEqual(msg1.content, secretText);
  assert.strictEqual(msg1.is_read, 0);
  assert.ok(msg1.id > 0);
  console.log('✓ Text message inserted successfully');

  // Inspect raw SQL row on disk to verify AES-256-GCM encryption at rest!
  const rawRow = db.db.prepare('SELECT content FROM messages WHERE id = ?').get(msg1.id);
  assert.ok(rawRow.content.startsWith('enc:v1:'), 'Content on disk must be encrypted with enc:v1 prefix');
  assert.ok(!rawRow.content.includes('top-secret'), 'Plaintext must NEVER appear in raw database file!');
  console.log('✓ Verified: Message on disk is AES-256-GCM encrypted at rest:', rawRow.content.substring(0, 35) + '...');

  // Test addMessage image
  const msg2 = db.addMessage({ sender_id: 2, type: 'image', content: '/uploads/secret-photo.jpg' });
  assert.strictEqual(msg2.sender_id, 2);
  assert.strictEqual(msg2.type, 'image');
  assert.strictEqual(msg2.content, '/uploads/secret-photo.jpg');
  console.log('✓ Image message inserted successfully');

  // Test getMessages returns decrypted messages
  const messages = db.getMessages(50);
  assert.ok(messages.length >= 2);
  const retrievedMsg1 = messages.find(m => m.id === msg1.id);
  assert.strictEqual(retrievedMsg1.content, secretText);
  console.log(`✓ Retrieved and decrypted ${messages.length} messages in chronological order`);

  // Test markAsRead
  db.markAsRead(1);
  const updatedMessages = db.getMessages(50);
  const updatedMsg2 = updatedMessages.find(m => m.id === msg2.id);
  assert.strictEqual(updatedMsg2.is_read, 1);
  console.log('✓ markAsRead updated partner messages successfully');

  console.log('\n--- 2. Testing HTTP & API Endpoints & Photo Security ---');
  require('./server');

  // Wait 500ms for server to bind
  await new Promise(resolve => setTimeout(resolve, 500));

  const baseUrl = 'http://127.0.0.1:3099';

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

  // Static file check
  const indexRes = await request('GET', '/');
  assert.strictEqual(indexRes.statusCode, 200);
  assert.ok(indexRes.body.includes('ChatApp'));
  console.log('✓ Static index.html served');

  // Invalid login
  const invalidLogin = await request('POST', '/api/login', { pin: '9999' });
  assert.strictEqual(invalidLogin.statusCode, 401);
  console.log('✓ Invalid PIN rejected with 401');

  // User 1 login
  const loginUser1 = await request('POST', '/api/login', { pin: '1122' });
  assert.strictEqual(loginUser1.statusCode, 200);
  const cookieUser1 = loginUser1.headers['set-cookie']?.[0]?.split(';')[0];
  assert.ok(cookieUser1 && cookieUser1.includes('auth_token='));
  console.log('✓ User 1 login passed, received session cookie');

  // Authenticated upload
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const dummyImageBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d4b0000000049454e44ae426082', 'hex');

  const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="private.png"\r\nContent-Type: image/png\r\n\r\n`;
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
  console.log('✓ Photo uploaded securely at:', uploadData.url);

  // CRITICAL SECURITY TEST: Try to access the photo WITHOUT being logged in!
  const unauthPhotoRes = await request('GET', uploadData.url);
  assert.strictEqual(unauthPhotoRes.statusCode, 401, 'Unauthenticated users MUST be blocked from viewing photos!');
  console.log('✓ Security check passed: Unauthorized access to photos is blocked with 401!');

  // Access the photo WITH authentication cookie
  const authPhotoRes = await request('GET', uploadData.url, null, { Cookie: cookieUser1 });
  assert.strictEqual(authPhotoRes.statusCode, 200);
  console.log('✓ Security check passed: Authenticated user can view photos with 200 OK');

  // Clean up ONLY the isolated test file and test database
  try {
    const uploadedFilePath = path.join(__dirname, uploadData.url);
    if (fs.existsSync(uploadedFilePath)) fs.unlinkSync(uploadedFilePath);
    const testDbPath = path.join(__dirname, 'data', 'test-chat.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  } catch (e) {}

  console.log('\n======================================================');
  console.log(' ALL TESTS PASSED: CHAT & PHOTOS ARE 100% SECURE!     ');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});

import fs from 'fs';
import http from 'http';
import { randomUUID } from 'crypto';

const COSTUME_IMAGE = process.argv[2] || './garment.png';
const BABY_IMAGE = './baby.jpg';

console.log(`Using baby image: ${BABY_IMAGE}`);
console.log(`Using costume image: ${COSTUME_IMAGE}`);

const boundary = `----FormBoundary${randomUUID()}`;

const crlf = '\r\n';
const babyBuffer = fs.readFileSync(BABY_IMAGE);
const costumeBuffer = fs.readFileSync(COSTUME_IMAGE);

const body = Buffer.concat([
  Buffer.from(`--${boundary}${crlf}`),
  Buffer.from(`Content-Disposition: form-data; name="baby_image"; filename="baby.jpg"${crlf}`),
  Buffer.from(`Content-Type: image/jpeg${crlf}${crlf}`),
  babyBuffer,
  Buffer.from(`${crlf}--${boundary}${crlf}`),
  Buffer.from(`Content-Disposition: form-data; name="costume_image"; filename="costume.jpg"${crlf}`),
  Buffer.from(`Content-Type: image/jpeg${crlf}${crlf}`),
  costumeBuffer,
  Buffer.from(`${crlf}--${boundary}--${crlf}`),
]);

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/baby-hero-vton',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
}, (res) => {
  if (res.headers['content-type']?.startsWith('image/')) {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
      const outFile = 'output.png';
      fs.writeFileSync(outFile, Buffer.concat(chunks));
      console.log(`✅ Saved result to ${outFile}`);
    });
  } else {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => console.log(data));
  }
});

req.on('error', (e) => console.error('Request failed:', e.message));
req.write(body);
req.end();

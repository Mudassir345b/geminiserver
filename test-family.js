import fs from 'fs';
import http from 'http';
import { randomUUID } from 'crypto';

const FAMILY_IMAGE = process.argv[2] || './family2.jpg';
const COSTUME_IMAGE = process.argv[3] || './garment.png';

console.log(`Family: ${FAMILY_IMAGE}`);
console.log(`Costume: ${COSTUME_IMAGE}`);

const boundary = `----FormBoundary${randomUUID()}`;
const crlf = '\r\n';
const familyBuffer = fs.readFileSync(FAMILY_IMAGE);
const costumeBuffer = fs.readFileSync(COSTUME_IMAGE);

const body = Buffer.concat([
  Buffer.from(`--${boundary}${crlf}`),
  Buffer.from(`Content-Disposition: form-data; name="family_image"; filename="family.jpg"${crlf}`),
  Buffer.from(`Content-Type: image/jpeg${crlf}${crlf}`),
  familyBuffer,
  Buffer.from(`${crlf}--${boundary}${crlf}`),
  Buffer.from(`Content-Disposition: form-data; name="costume_image"; filename="costume.png"${crlf}`),
  Buffer.from(`Content-Type: image/png${crlf}${crlf}`),
  costumeBuffer,
  Buffer.from(`${crlf}--${boundary}--${crlf}`),
]);

const req = http.request({
  hostname: 'localhost', port: 3001, path: '/api/v1/family-vton',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
}, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    if (res.headers['content-type']?.startsWith('image/')) {
      const outFile = 'output_family.jpg';
      fs.writeFileSync(outFile, Buffer.concat(chunks));
      console.log(`✅ Saved to ${outFile} (${Buffer.concat(chunks).length} bytes)`);
    } else {
      console.log('Response:', Buffer.concat(chunks).toString());
    }
    process.exit(0);
  });
});
req.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
req.write(body);
req.end();

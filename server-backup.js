import { GoogleGenAI } from '@google/genai';
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import sharp from 'sharp';
import { apiReference } from '@scalar/express-api-reference';

const app = express();
const upload = multer({ dest: 'uploads/' });

process.env.GOOGLE_APPLICATION_CREDENTIALS = './gcp-key.json';
const gcpKey = JSON.parse(fs.readFileSync('./gcp-key.json', 'utf8'));

const ai = new GoogleGenAI({
  vertexai: true,
  project: gcpKey.project_id,
  location: 'us-central1'
});

app.use(express.json());

async function retry429(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      const hit = err.status === 429 || err.message?.includes('RESOURCE_EXHAUSTED');
      if (hit && i < retries - 1) {
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      } else { throw err; }
    }
  }
}

/**
 * 🔁 Backup route — identical to baby-hero-vton in server.js.
 * Safe to modify and experiment on without breaking the main endpoint.
 */
app.post('/api/v1/baby-hero-vton-backup', upload.fields([{ name: 'baby_image' }, { name: 'costume_image' }]), async (req, res) => {
  try {
    if (!req.files?.['baby_image'] || !req.files?.['costume_image']) {
      return res.status(400).json({ success: false, error: 'baby_image and costume_image are required.' });
    }

    const babyBuffer = fs.readFileSync(req.files['baby_image'][0].path);
    const costumeBuffer = fs.readFileSync(req.files['costume_image'][0].path);
    const babyMime = req.files['baby_image'][0].mimetype || 'image/jpeg';

    const response = await retry429(() => ai.models.recontextImage({
      model: 'virtual-try-on-001',
      source: {
        personImage: { imageBytes: babyBuffer.toString('base64'), mimeType: babyMime },
        productImages: [{ productImage: { imageBytes: costumeBuffer.toString('base64'), mimeType: 'image/png' } }]
      },
      config: {
        numberOfImages: 1,
        personGeneration: 'ALLOW_ALL'
      }
    }));

    const resultImage = response.generatedImages?.[0];
    if (!resultImage?.image?.imageBytes) {
      return res.status(500).json({ success: false, error: 'No generated image returned from model.' });
    }

    const resultBuffer = Buffer.from(resultImage.image.imageBytes, 'base64');

    fs.unlinkSync(req.files['baby_image'][0].path);
    fs.unlinkSync(req.files['costume_image'][0].path);

    res.set('Content-Type', 'image/png');
    res.send(resultBuffer);

  } catch (err) {
    if (req.files) {
      if (req.files['baby_image']) fs.unlinkSync(req.files['baby_image'][0].path);
      if (req.files['costume_image']) fs.unlinkSync(req.files['costume_image'][0].path);
    }
    console.error("VTON Backup Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function detectBabyBbox(familyBuffer) {
  const metadata = await sharp(familyBuffer).metadata();
  const { width, height } = metadata;
  const COLS = 6, ROWS = 4;
  const cellW = Math.floor(width / COLS);
  const cellH = Math.floor(height / ROWS);

  function cellsToBbox(cellNums) {
    const cols = new Set(), rows = new Set();
    for (const n of cellNums) {
      cols.add((n - 1) % COLS);
      rows.add(Math.floor((n - 1) / COLS));
    }
    const colArr = [...cols], rowArr = [...rows];
    return {
      left: Math.min(...colArr) * cellW,
      top: Math.min(...rowArr) * cellH,
      width: Math.min((Math.max(...colArr) - Math.min(...colArr) + 1) * cellW, width - Math.min(...colArr) * cellW),
      height: Math.min((Math.max(...rowArr) - Math.min(...rowArr) + 1) * cellH, height - Math.min(...rowArr) * cellH)
    };
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await retry429(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [
            {
              text: `This image is divided into a ${COLS}×${ROWS}=${COLS*ROWS} cell grid numbered 1-${COLS*ROWS} (left-to-right, top-to-bottom, 1=top-left). Identify which cells contain the baby/youngest child. Exclude adults completely. Return ONLY a JSON array like [5,6,9,10] with no other text.`
            },
            { inlineData: { mimeType: 'image/jpeg', data: familyBuffer.toString('base64') } }
          ]
        }]
      }));

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log(`Gemini grid attempt ${attempt}:`, text.substring(0, 200));
      const jsonMatch = text.match(/\[[\d,\s]+\]/);
      if (jsonMatch) {
        const cells = JSON.parse(jsonMatch[0]);
        if (cells.length > 0 && cells.length <= COLS * ROWS) {
          const bbox = cellsToBbox(cells);
          if (bbox.width > 0 && bbox.height > 0) {
            console.log('Grid-based bbox:', bbox);
            return bbox;
          }
        }
      }
    } catch (e) {
      console.warn(`Gemini grid attempt ${attempt} failed:`, e.message);
    }
  }

  throw new Error('Could not detect baby in photo. Please use a clearer photo where the baby is visible and not obstructed.');
}

app.post('/api/v1/family-vton', upload.fields([{ name: 'family_image' }, { name: 'costume_image' }]), async (req, res) => {
  try {
    if (!req.files?.['family_image'] || !req.files?.['costume_image']) {
      return res.status(400).json({ success: false, error: 'family_image and costume_image are required.' });
    }

    const familyBuffer = fs.readFileSync(req.files['family_image'][0].path);
    const costumeBuffer = fs.readFileSync(req.files['costume_image'][0].path);

    const bbox = await detectBabyBbox(familyBuffer);
    if (bbox) {
      const meta = await sharp(familyBuffer).metadata();
      bbox.left = Math.max(0, bbox.left);
      bbox.top = Math.max(0, bbox.top);
      bbox.width = Math.min(bbox.width, meta.width - bbox.left);
      bbox.height = Math.min(bbox.height, meta.height - bbox.top);
    }
    console.log('Detected baby crop:', bbox);

    const babyCropBuffer = await sharp(familyBuffer).extract(bbox).png().toBuffer();
    fs.writeFileSync('debug_cropped_baby_family.png', babyCropBuffer);

    const vtonResponse = await retry429(() => ai.models.recontextImage({
      model: 'virtual-try-on-001',
      source: {
        personImage: { imageBytes: babyCropBuffer.toString('base64'), mimeType: 'image/png' },
        productImages: [{ productImage: { imageBytes: costumeBuffer.toString('base64'), mimeType: 'image/png' } }]
      },
      config: {
        numberOfImages: 1,
        personGeneration: 'ALLOW_ALL'
      }
    }));

    const resultImage = vtonResponse.generatedImages?.[0];
    if (!resultImage?.image?.imageBytes) {
      return res.status(500).json({ success: false, error: 'VTON did not return a generated image.' });
    }

    const dressedBuffer = Buffer.from(resultImage.image.imageBytes, 'base64');
    fs.writeFileSync('debug_dressed_family.png', dressedBuffer);

    const dressedResized = await sharp(dressedBuffer)
      .resize(bbox.width, bbox.height, { fit: 'fill' })
      .png()
      .toBuffer();

    const familyMetadata = await sharp(familyBuffer).metadata();
    const finalBuffer = await sharp(familyBuffer)
      .composite([{ input: dressedResized, top: bbox.top, left: bbox.left }])
      .jpeg({ quality: 95 })
      .toBuffer();

    fs.unlinkSync(req.files['family_image'][0].path);
    fs.unlinkSync(req.files['costume_image'][0].path);

    res.set('Content-Type', 'image/jpeg');
    res.send(finalBuffer);

  } catch (err) {
    if (req.files) {
      if (req.files['family_image']) fs.unlinkSync(req.files['family_image'][0].path);
      if (req.files['costume_image']) fs.unlinkSync(req.files['costume_image'][0].path);
    }
    console.error('Family VTON Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Same docs as server.js so the backup shows up in the Scalar UI
app.use('/docs', apiReference({
  theme: 'saturn',
  spec: {
    content: {
      openapi: '3.0.0',
      info: {
        title: 'Baby VTON Pipeline',
        version: '1.0.0',
        description: 'Virtual try-on for baby costume photos.',
      },
      paths: {
        '/api/v1/baby-hero-vton-backup': {
          post: {
            summary: 'Baby VTON Backup (safe to modify)',
            description: 'Identical to baby-hero-vton. Use for experimenting.',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      baby_image: { type: 'string', format: 'binary' },
                      costume_image: { type: 'string', format: 'binary' }
                    },
                    required: ['baby_image', 'costume_image']
                  }
                }
              }
            },
            responses: { 200: { description: 'Result image.', content: { 'image/png': {} } } }
          }
        },
        '/api/v1/family-vton': {
          post: {
            summary: 'Family Photo Baby VTON',
            description: 'Upload a family photo + costume image. Extracts baby, applies virtual try-on, composites back. Parents & background unchanged.',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      family_image: { type: 'string', format: 'binary' },
                      costume_image: { type: 'string', format: 'binary' }
                    },
                    required: ['family_image', 'costume_image']
                  }
                }
              }
            },
            responses: { 200: { description: 'Result image with dressed baby composited into family photo.', content: { 'image/jpeg': {} } } }
          }
        }
      }
    },
  },
}));

app.listen(3001, () => console.log('🚀 Backup server :3001 | http://localhost:3001/docs'));

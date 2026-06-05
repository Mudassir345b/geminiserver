import { GoogleGenAI } from '@google/genai';
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import { apiReference } from '@scalar/express-api-reference';

const app = express();
const upload = multer({ dest: 'uploads/' });

// Authentication Configuration 
process.env.GOOGLE_APPLICATION_CREDENTIALS = './gcp-key.json';
const gcpKey = JSON.parse(fs.readFileSync('./gcp-key.json', 'utf8'));

// Initializing the Official Unified Google Gen AI SDK
const ai = new GoogleGenAI({
  vertexai: true,
  project: gcpKey.project_id,
  location: 'us-central1' 
});

app.use(express.json());

// Global Rate-Limit (429) Resiliency Handler with Exponential Backoff
async function retry429(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { 
      return await fn(); 
    } catch (err) {
      const hitQuota = err.status === 429 || err.message?.includes('RESOURCE_EXHAUSTED');
      if (hitQuota && i < retries - 1) {
        const backoffDelay = (i + 1) * 2500;
        console.warn(`[Quota Hit] Retrying execution pipeline in ${backoffDelay}ms...`);
        await new Promise(r => setTimeout(r, backoffDelay));
      } else { 
        throw err; 
      }
    }
  }
}

/**
 * UNIFIED IMAGE FUSION PIPELINE
 * Handles standalone babies or multi-person family layouts instantly.
 */
app.post('/api/v1/family-vton', upload.fields([{ name: 'family_image' }, { name: 'costume_image' }]), async (req, res) => {
  try {
    if (!req.files?.['family_image'] || !req.files?.['costume_image']) {
      return res.status(400).json({ success: false, error: 'Both family_image and costume_image parameters must be uploaded.' });
    }

    const familyBuffer = fs.readFileSync(req.files['family_image'][0].path);
    const costumeBuffer = fs.readFileSync(req.files['costume_image'][0].path);

    // Call the high-efficiency image understanding & generation engine (Nano Banana)
    const response = await retry429(() => ai.models.generateContent({
      model: 'gemini-3.1-flash-image', // Native conversational image generation & editing engine
      contents: [
        {
          role: 'user',
          parts: [
            { 
              text: `You are an expert photo compositing application. Look closely at the two attached images.
                     Image 1: A photo containing a baby (either alone or held within a family setting).
                     Image 2: A child's costume apparel item.
                     
                     Your task: Modify Image 1 by clothing ONLY the baby/youngest child in the exact costume outfit shown in Image 2.
                     CRITICAL RULES:
                     1. Keep the baby's original face, features, expressions, hair, and placement identical.
                     2. Do not change or remove any adults, background elements, lighting configurations, or surrounding scenery.
                     3. Do not alter the baby's pose or body position. The costume must be morphed and fitted onto the existing baby frame as-is.
                     4. Do not add any extra elements, text, or graphics. The output should be a single clean image with the baby dressed in the new outfit, and everything else preserved perfectly.
                     5. Ensure the costume is realistically blended with the baby's body, including proper occlusion, shadowing, and edge refinement.
                     6. The final output should look like a genuine, unedited photograph where the baby is naturally wearing the new costume, without any signs of digital manipulation or compositing artifacts.
                     7. Donot change the baby's skin tone or color grading. The costume should match the lighting and color scheme of the original photo seamlessly. And also donot change the baby's hands, feet, or any visible body parts. Only the clothing should be altered.
                     8. Match the lightning, textures, and shading of the costume body cleanly to match the original photo's climate.
                     9. Output only the updated edited image canvas.
                     10. Donot add extra legs, arms, or accessories to the baby. The costume should be fitted onto the existing body structure without adding new limbs or props.
                     11.  Donot add any extra limbs, accessories, or props to the baby. Only the clothing should be changed. The baby's body structure and silhouette must remain exactly the same as the original photo.`
            },
            { inlineData: { mimeType: 'image/jpeg', data: familyBuffer.toString('base64') } },
            { inlineData: { mimeType: 'image/png', data: costumeBuffer.toString('base64') } }
          ]
        }
      ],
      config: {
        // Tells Gemini to return a binary image data object instead of simple conversational text
        responseModalities: ["IMAGE"]
      }
    }));

    // Parse the multimodal payload structure to extract the raw generated canvas
    const outputPart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData || part.image);
    
    if (!outputPart) {
      return res.status(500).json({ success: false, error: 'The generative engine failed to compute a visual transformation frame.' });
    }

    const base64Data = outputPart.inlineData ? outputPart.inlineData.data : outputPart.image.imageBytes;
    const resultBuffer = Buffer.from(base64Data, 'base64');

    // Clean up local temp disk allocation
    fs.unlinkSync(req.files['family_image'][0].path);
    fs.unlinkSync(req.files['costume_image'][0].path);

    res.set('Content-Type', 'image/jpeg');
    res.send(resultBuffer);

  } catch (err) {
    if (req.files) {
      if (req.files['family_image'] && fs.existsSync(req.files['family_image'][0].path)) fs.unlinkSync(req.files['family_image'][0].path);
      if (req.files['costume_image'] && fs.existsSync(req.files['costume_image'][0].path)) fs.unlinkSync(req.files['costume_image'][0].path);
    }
    console.error('Pipeline Processing Failure:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * SCALAR INTERACTIVE DOCUMENTATION PLATFORM
 */
app.use('/docs', apiReference({
  theme: 'saturn',
  spec: {
    content: {
      openapi: '3.0.0',
      info: {
        title: 'Nano Banana Virtual Try-On API',
        version: '2.0.0',
        description: 'Blazing fast, zero-crop multi-image fusion suite powered by Gemini 3.1 Flash Image. Processes standalone babies and complex family frames seamlessly using the same endpoint.',
      },
      paths: {
        '/api/v1/family-vton': {
          post: {
            summary: 'Execute Unified Dress-Up / Try-On Transformation',
            description: 'Upload a base canvas image (single baby or full family scene) and a target outfit garment file. The engine identifies the target baby subject automatically, morphs the wardrobe layer seamlessly, and preserves ambient parameters.',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      family_image: { 
                        type: 'string', 
                        format: 'binary',
                        description: 'The base image (e.g. Baby picture, or Family group portrait shot)'
                      },
                      costume_image: { 
                        type: 'string', 
                        format: 'binary',
                        description: 'The reference product costume layout file (PNG / JPEG)'
                      }
                    },
                    required: ['family_image', 'costume_image']
                  }
                }
              }
            },
            responses: {
              200: {
                description: 'Polished image with dressed target composited cleanly inside.',
                content: { 'image/jpeg': {} }
              },
              400: { description: 'Missing necessary image payloads.' },
              500: { description: 'Model generation or connection error.' }
            }
          }
        }
      }
    },
  },
}));

app.listen(3000, () => {
  console.log('===========================================================');
  console.log('🚀 Nano-Banana Pipeline Operational on Port 3000');
  console.log('📖 Interactive Scalar Tester: http://localhost:3000/docs');
  console.log('===========================================================');
});
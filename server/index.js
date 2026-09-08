import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { runDetectors, describeDetectors } from './detectors/index.js';
import { summarize } from './lib/scoring.js';
import { detectMediaKind, humanSize, ACCEPTED, ACCEPT_ATTRIBUTE } from './lib/media.js';
import { inspectContentCredentials } from './lib/c2pa.js';
import { REVERSE_SEARCH_ENGINES } from './lib/links.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024;

// Files are held in memory and forwarded straight to the detectors — nothing
// touches disk, and the buffer is released when the response is sent.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/config', (_req, res) => {
  res.json({
    detectors: describeDetectors(process.env),
    accept: ACCEPT_ATTRIBUTE,
    accepted: ACCEPTED,
    maxUploadMb: MAX_UPLOAD_BYTES / 1024 / 1024,
    demoMode: String(process.env.DEMO_MODE ?? '').toLowerCase() === 'true',
    reverseSearch: REVERSE_SEARCH_ENGINES,
  });
});

app.post('/api/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send one file under the field name "file".' });
  }

  const media = detectMediaKind(req.file);
  if (!media) {
    return res.status(415).json({
      error: 'Unsupported file type. Upload an image (.jpg, .png, .webp) or audio file (.mp3, .wav, .m4a).',
    });
  }

  const file = {
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
    kind: media.kind,
    format: media.format,
  };

  const results = await runDetectors(file, process.env);
  const summary = summarize(results);

  res.json({
    file: {
      name: file.filename,
      kind: file.kind,
      format: file.format,
      size: req.file.size,
      sizeLabel: humanSize(req.file.size),
    },
    ...summary,
    contentCredentials: media.kind === 'image'
      ? inspectContentCredentials(req.file.buffer, media.format)
      : null,
    reverseSearch: media.kind === 'image' ? REVERSE_SEARCH_ENGINES : [],
    disclaimer: 'Detection is probabilistic. Combine with reverse image search and source checking — no tool is conclusive.',
  });
});

// Multer's own errors (file too large, too many files) should read as plain English.
app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `File is larger than the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`
      : `Upload rejected: ${error.message}`;
    return res.status(413).json({ error: message });
  }
  if (error) return res.status(500).json({ error: 'Something went wrong analyzing that file.' });
  return next();
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    const configured = describeDetectors(process.env).filter((d) => d.configured);
    const demoMode = String(process.env.DEMO_MODE ?? '').toLowerCase() === 'true';
    console.log(`Is-It-AI running at http://localhost:${PORT}`);
    if (configured.length) {
      console.log(`Detectors configured: ${configured.map((d) => d.name).join(', ')}`);
    }
    if (demoMode) {
      console.log('DEMO_MODE is on: tools without keys return simulated scores, not real detections.');
    } else if (!configured.length) {
      console.log('No detector API keys found. Copy .env.example to .env and add keys (or set DEMO_MODE=true).');
    }
  });
}

export default app;

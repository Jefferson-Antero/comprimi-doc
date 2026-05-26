const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { compressPdf, hasGhostscript } = require('./compressors/pdf');
const { compressOffice, isOfficeFile } = require('./compressors/office');
const { hasLibreOffice, hasMicrosoftWord, getDocEngine, docToDocx, bufferToTempFile } = require('./compressors/doc');

const app = express();
const PORT = process.env.PORT || 3333;
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB upload limit
const TARGET_SIZE = 80 * 1024 * 1024; // 80MB TCE-RJ limit

// Cache capability checks at startup — avoid spawning processes on every request
const CAPS = {
  ghostscript: hasGhostscript(),
  libreoffice: hasLibreOffice(),
  msword: hasMicrosoftWord(),
};

// Detect local network IP dynamically
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const EXPOSED_HEADERS = 'X-Compress-Ratio,X-Input-Size,X-Output-Size,X-Zip-Size,X-Engine,X-Fits-TCE,X-Zip-Name,X-Converted-To';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json());

// Rate limit: max 20 compressions per minute per IP
app.use('/compress', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Muitas requisições. Aguarde um minuto e tente novamente.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

const ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp'];

// Sanitize filename: remove characters invalid on Windows/ZIP
function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-'));
      req.tmpDir = tmpDir;
      cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
      cb(null, `input${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo não suportado: ${ext}. Use PDF, DOC ou Office (docx, xlsx, pptx, odt, ods, odp).`));
    }
  },
});

async function buildZip(compressedFilePath, filenameInsideZip) {
  const zip = new JSZip();
  const fileBuffer = fs.readFileSync(compressedFilePath);
  zip.file(filenameInsideZip, fileBuffer);
  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ghostscript: CAPS.ghostscript,
    libreoffice: CAPS.libreoffice,
    msword: CAPS.msword,
    targetSize: '80MB (TCE-RJ)',
  });
});

app.post('/compress', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const inputPath = req.file.path;
  // multer/busboy may decode filename bytes as latin1 when browser sends UTF-8 — detect and fix
  const latin1Attempt = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const decodedName = !latin1Attempt.includes('�') && latin1Attempt !== req.file.originalname
    ? latin1Attempt
    : req.file.originalname;
  const ext = path.extname(decodedName).toLowerCase();
  const rawName = path.basename(decodedName, ext);
  const originalName = sanitizeName(rawName);

  const isDoc = ext === '.doc';
  const outputExt = isDoc ? '.docx' : ext;
  const compressedName = `${originalName}_comprimido${outputExt}`;
  const zipName = `${originalName}_comprimido.zip`;
  const outputPath = path.join(req.tmpDir, compressedName);

  let convTmpDir = null;

  try {
    let result;

    if (ext === '.pdf') {
      result = await compressPdf(inputPath, outputPath);
    } else if (isDoc) {
      const docEngine = getDocEngine();
      const docxBuffer = await docToDocx(inputPath);
      const { tmpPath: convPath, tmpDir } = bufferToTempFile(docxBuffer, '.docx');
      convTmpDir = tmpDir;
      result = await compressOffice(convPath, outputPath);
      result.engine = `${docEngine}+re-zip+sharp`;
    } else if (isOfficeFile(req.file.originalname)) {
      result = await compressOffice(inputPath, outputPath);
    } else {
      throw new Error('Tipo de arquivo não suportado.');
    }

    const zipBuffer = await buildZip(outputPath, compressedName);
    const zipSize = zipBuffer.length;
    const fits = zipSize <= TARGET_SIZE;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    res.setHeader('X-Compress-Ratio', result.ratio);
    res.setHeader('X-Input-Size', result.inputSize);
    res.setHeader('X-Output-Size', result.outputSize);
    res.setHeader('X-Zip-Size', zipSize);
    res.setHeader('X-Engine', result.engine);
    res.setHeader('X-Fits-TCE', fits ? 'true' : 'false');
    res.setHeader('X-Zip-Name', encodeURIComponent(zipName));
    if (isDoc) res.setHeader('X-Converted-To', '.docx');

    res.end(zipBuffer);
  } catch (err) {
    // Log full error server-side only — never expose internals to client
    console.error('Compression error:', err);
    const safe = err.message?.includes('LibreOffice') || err.message?.includes('Word')
      ? err.message
      : 'Erro ao processar arquivo. Tente novamente.';
    res.status(500).json({ error: safe });
  } finally {
    if (convTmpDir) fs.rmSync(convTmpDir, { recursive: true, force: true });
    if (req.tmpDir) fs.rmSync(req.tmpDir, { recursive: true, force: true });
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Arquivo muito grande. Limite: 500MB.' });
  }
  res.status(400).json({ error: err.message });
});

// Serve frontend static files (production)
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback — return index.html for any unmatched route
  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

const LOCAL_IP = getLocalIp();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`Rede local:        http://${LOCAL_IP}:${PORT}`);
  console.log(`Ghostscript: ${CAPS.ghostscript} | LibreOffice: ${CAPS.libreoffice} | Word: ${CAPS.msword}`);
  console.log(`Limite TCE-RJ: 80MB`);
});

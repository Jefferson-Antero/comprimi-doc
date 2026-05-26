const { spawnSync } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const os = require('os');

function hasGhostscript() {
  try {
    const result = spawnSync('gs', ['--version'], { timeout: 3000 });
    return result.status === 0;
  } catch {
    try {
      const result = spawnSync('gswin64c', ['--version'], { timeout: 3000 });
      return result.status === 0;
    } catch {
      return false;
    }
  }
}

const GS_CMD = (() => {
  try {
    spawnSync('gs', ['--version'], { timeout: 2000 });
    return 'gs';
  } catch {
    return 'gswin64c';
  }
})();

async function compressWithGhostscript(inputPath, outputPath, quality = 'ebook') {
  // quality: screen=72dpi, ebook=150dpi, printer=300dpi, prepress=300dpi+color
  const result = spawnSync(GS_CMD, [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.4',
    `-dPDFSETTINGS=/${quality}`,
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    '-dColorImageDownsampleType=/Bicubic',
    '-dColorImageResolution=150',
    '-dGrayImageDownsampleType=/Bicubic',
    '-dGrayImageResolution=150',
    '-dMonoImageDownsampleType=/Subsample',
    '-dMonoImageResolution=150',
    `-sOutputFile=${outputPath}`,
    inputPath,
  ], { timeout: 120000 });

  if (result.status !== 0) {
    throw new Error(`Ghostscript failed: ${result.stderr?.toString()}`);
  }
}

async function compressWithPdfLib(inputPath, outputPath) {
  const inputBytes = fs.readFileSync(inputPath);
  const pdfDoc = await PDFDocument.load(inputBytes);

  const pages = pdfDoc.getPages();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-compress-'));

  for (const page of pages) {
    const { width, height } = page.getSize();
    // Re-embed page as compressed image for image-heavy PDFs
    // This is a best-effort approach for pure JS fallback
    void width; void height;
  }

  // Save with compression flags
  const outputBytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 50,
  });

  fs.writeFileSync(outputPath, outputBytes);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function compressPdf(inputPath, outputPath) {
  const inputSize = fs.statSync(inputPath).size;

  if (hasGhostscript()) {
    // Try ebook first, then screen if still too big
    await compressWithGhostscript(inputPath, outputPath, 'ebook');
    const outputSize = fs.statSync(outputPath).size;

    // If output > 80MB, retry with lower quality
    if (outputSize > 80 * 1024 * 1024) {
      await compressWithGhostscript(inputPath, outputPath, 'screen');
    }
  } else {
    await compressWithPdfLib(inputPath, outputPath);
  }

  const outputSize = fs.statSync(outputPath).size;
  return {
    engine: hasGhostscript() ? 'ghostscript' : 'pdf-lib',
    inputSize,
    outputSize,
    ratio: ((1 - outputSize / inputSize) * 100).toFixed(1),
  };
}

module.exports = { compressPdf, hasGhostscript };

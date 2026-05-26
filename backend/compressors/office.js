const JSZip = require('jszip');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp']);

const OFFICE_MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
};

async function compressImage(buffer, ext) {
  const lowerExt = ext.toLowerCase();
  try {
    let pipeline = sharp(buffer);
    const meta = await pipeline.metadata();

    // Downscale if image exceeds 2000px on longest side
    if (meta.width > 2000 || meta.height > 2000) {
      pipeline = pipeline.resize(2000, 2000, { fit: 'inside', withoutEnlargement: true });
    }

    if (lowerExt === '.png') {
      return await pipeline.png({ compressionLevel: 9, quality: 80 }).toBuffer();
    } else if (lowerExt === '.gif') {
      // Keep GIF as-is (sharp can't maintain animation well)
      return buffer;
    } else {
      return await pipeline.jpeg({ quality: 75, progressive: true }).toBuffer();
    }
  } catch {
    return buffer; // Return original if sharp fails on this image
  }
}

async function compressOffice(inputPath, outputPath) {
  const inputBuffer = fs.readFileSync(inputPath);
  const inputSize = inputBuffer.length;
  const ext = path.extname(inputPath).toLowerCase();

  const zip = await JSZip.loadAsync(inputBuffer);
  const compressedImages = { count: 0, savedBytes: 0 };

  const imageFiles = Object.keys(zip.files).filter((name) => {
    const fileExt = path.extname(name).toLowerCase();
    return IMAGE_EXTENSIONS.has(fileExt) && !zip.files[name].dir;
  });

  await Promise.all(
    imageFiles.map(async (name) => {
      const fileExt = path.extname(name).toLowerCase();
      const originalBuffer = await zip.files[name].async('nodebuffer');
      const compressedBuffer = await compressImage(originalBuffer, fileExt);

      if (compressedBuffer.length < originalBuffer.length) {
        compressedImages.savedBytes += originalBuffer.length - compressedBuffer.length;
        compressedImages.count++;
        zip.file(name, compressedBuffer, { binary: true });
      }
    })
  );

  const outputBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  fs.writeFileSync(outputPath, outputBuffer);

  return {
    engine: 're-zip+sharp',
    inputSize,
    outputSize: outputBuffer.length,
    ratio: ((1 - outputBuffer.length / inputSize) * 100).toFixed(1),
    compressedImages: compressedImages.count,
  };
}

function isOfficeFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext in OFFICE_MIME;
}

module.exports = { compressOffice, isOfficeFile, OFFICE_MIME };

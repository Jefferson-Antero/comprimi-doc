const libre = require('libreoffice-convert');
const { promisify } = require('util');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const libreConvert = promisify(libre.convert);

const SOFFICE_PATHS = [
  'soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];

function hasLibreOffice() {
  for (const bin of SOFFICE_PATHS) {
    try {
      const result = spawnSync(bin, ['--version'], { timeout: 4000, shell: false });
      if (result.status === 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function hasMicrosoftWord() {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command',
        'try { $w = New-Object -ComObject Word.Application; $w.Quit(); Write-Output "OK" } catch { Write-Output "FAIL" }'
      ],
      { timeout: 8000, shell: false }
    );
    return result.stdout?.toString().trim() === 'OK';
  } catch {
    return false;
  }
}

// Convert .doc → .docx via PowerShell Word COM — paths passed via JSON file, never interpolated
async function docToDocxViaWord(inputPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'word-conv-'));
  const outputPath = path.join(tmpDir, 'output.docx');
  const argsFile = path.join(tmpDir, 'args.json');

  // Pass paths through a JSON file — no shell interpolation risk
  fs.writeFileSync(argsFile, JSON.stringify({ input: inputPath, output: outputPath }), 'utf8');

  const script = `
$ErrorActionPreference = 'Stop'
$cfg = Get-Content '${argsFile}' | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($cfg.input)
  $doc.SaveAs([ref]$cfg.output, [ref]16)
  $doc.Close($false)
} finally {
  $word.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
}
Write-Output "OK"
`.trim();

  const scriptFile = path.join(tmpDir, 'convert.ps1');
  fs.writeFileSync(scriptFile, script, 'utf8');

  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
    { timeout: 60000, shell: false }
  );

  if (result.status !== 0 || result.stdout?.toString().trim() !== 'OK') {
    const stderr = result.stderr?.toString().trim() || '';
    const stdout = result.stdout?.toString().trim() || '';
    console.error('Word COM stderr:', stderr);
    console.error('Word COM stdout:', stdout);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error('Word COM conversion failed. Verifique se o Microsoft Word está instalado.');
  }

  const docxBuffer = fs.readFileSync(outputPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return docxBuffer;
}

async function docToDocxViaLibre(inputPath) {
  const inputBuffer = fs.readFileSync(inputPath);
  return await libreConvert(inputBuffer, '.docx', undefined);
}

async function docToDocx(inputPath) {
  if (hasLibreOffice()) {
    return await docToDocxViaLibre(inputPath);
  }
  if (hasMicrosoftWord()) {
    return await docToDocxViaWord(inputPath);
  }
  throw new Error(
    'Conversão de .doc requer LibreOffice ou Microsoft Word instalado. ' +
    'Instale LibreOffice: https://www.libreoffice.org/download/'
  );
}

function getDocEngine() {
  if (hasLibreOffice()) return 'libreoffice';
  if (hasMicrosoftWord()) return 'ms-word-com';
  return null;
}

function bufferToTempFile(buffer, ext) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-conv-'));
  const tmpPath = path.join(tmpDir, `converted${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return { tmpPath, tmpDir };
}

module.exports = { hasLibreOffice, hasMicrosoftWord, getDocEngine, docToDocx, bufferToTempFile };

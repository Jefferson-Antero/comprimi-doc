import { useState, useCallback } from 'react';
import { FileText, Upload, Download, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import './App.css';

// Em dev (Vite :5173) aponta pro backend :3333. Em produção (PM2) same-origin, URL relativa.
const API_URL = window.location.port === '5173'
  ? `${window.location.protocol}//${window.location.hostname}:3333`
  : '';
const MAX_SIZE_MB = 80;
const ACCEPTED = '.pdf,.doc,.docx,.xlsx,.pptx,.odt,.ods,.odp';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function FileIcon({ ext }) {
  const colors = {
    pdf: '#e53e3e', doc: '#2b5ce6', docx: '#2b5ce6', xlsx: '#1d6f42',
    pptx: '#d04000', odt: '#2b5ce6', ods: '#1d6f42', odp: '#d04000',
  };
  return (
    <div className="file-icon" style={{ backgroundColor: colors[ext] || '#718096' }}>
      {ext?.toUpperCase() || 'FILE'}
    </div>
  );
}

function ProgressBar({ value, color = '#4f46e5' }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }} />
    </div>
  );
}

function FileCard({ file, onRemove, onCompress }) {
  const ext = file.name.split('.').pop().toLowerCase();

  const statusIcon = {
    idle: null,
    compressing: <Loader2 size={18} className="spin" />,
    done: file.result?.fitsTce
      ? <CheckCircle size={18} color="#22c55e" />
      : <AlertTriangle size={18} color="#f59e0b" />,
    error: <XCircle size={18} color="#ef4444" />,
  }[file.status];

  return (
    <div className={`file-card status-${file.status}`}>
      <FileIcon ext={ext} />
      <div className="file-info">
        <span className="file-name" title={file.name}>{file.name}</span>
        <span className="file-meta">
          {formatBytes(file.size)}
          {file.result && (
            <>
              {' → '}{formatBytes(file.result.outputSize)}
              <strong className="ratio"> ({file.result.ratio}% menor)</strong>
              {file.result.zipSize && (
                <span className="zip-badge"> · ZIP: {formatBytes(file.result.zipSize)}</span>
              )}
              {file.convertedTo && (
                <span className="converted-badge"> · convertido para {file.convertedTo}</span>
              )}
              {!file.result.fitsTce && (
                <span className="warning-badge"> ⚠ ZIP acima de {MAX_SIZE_MB}MB</span>
              )}
            </>
          )}
          {file.error && <span className="error-text"> — {file.error}</span>}
        </span>
        {file.status === 'compressing' && <ProgressBar value={50} />}
        {file.result && (
          <ProgressBar
            value={(file.result.outputSize / file.result.inputSize) * 100}
            color={file.result.fitsTce ? '#22c55e' : '#f59e0b'}
          />
        )}
      </div>
      <div className="file-actions">
        {statusIcon}
        {file.status === 'idle' && (
          <button className="btn-compress-single" onClick={() => onCompress(file.id)} title="Comprimir">
            Comprimir
          </button>
        )}
        {file.status === 'done' && file.downloadUrl && (
          <a href={file.downloadUrl} download={file.outputName} className="btn-download" title="Baixar">
            <Download size={16} />
          </a>
        )}
        {file.status !== 'compressing' && (
          <button className="btn-remove" onClick={() => onRemove(file.id)} title="Remover">×</button>
        )}
      </div>
    </div>
  );
}

let nextId = 1;

export default function App() {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [health, setHealth] = useState(null);

  // Check backend health on mount
  useState(() => {
    fetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'offline' }));
  }, []);

  const addFiles = useCallback((fileList) => {
    const allowed = new Set(['pdf', 'doc', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);
    const newFiles = Array.from(fileList)
      .filter((f) => allowed.has(f.name.split('.').pop().toLowerCase()))
      .map((f) => ({
        id: nextId++,
        file: f,
        name: f.name,
        size: f.size,
        status: 'idle',
        result: null,
        error: null,
        downloadUrl: null,
        outputName: null,
      }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const compressFile = useCallback(async (id) => {
    setFiles((prev) => prev.map((f) => f.id === id ? { ...f, status: 'compressing', error: null } : f));

    const entry = files.find((f) => f.id === id);
    if (!entry) return;

    const formData = new FormData();
    formData.append('file', entry.file);

    try {
      const res = await fetch(`${API_URL}/compress`, { method: 'POST', body: formData });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Falha na compressão');
      }

      const inputSize = parseInt(res.headers.get('X-Input-Size'), 10);
      const outputSize = parseInt(res.headers.get('X-Output-Size'), 10);
      const zipSize = parseInt(res.headers.get('X-Zip-Size'), 10);
      const ratio = res.headers.get('X-Compress-Ratio');
      const engine = res.headers.get('X-Engine');
      const fitsTce = res.headers.get('X-Fits-TCE') === 'true';
      const convertedTo = res.headers.get('X-Converted-To');
      const zipName = res.headers.get('X-Zip-Name') ? decodeURIComponent(res.headers.get('X-Zip-Name')) : null;

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);

      // outputName is always .zip (ready for TCE-RJ assinador)
      const ext = entry.name.split('.').pop();
      const baseName = entry.name.slice(0, -(ext.length + 1));
      const outputName = zipName || `${baseName}_comprimido.zip`;

      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, status: 'done', downloadUrl, outputName, convertedTo, result: { inputSize, outputSize, zipSize, ratio, engine, fitsTce } }
            : f
        )
      );
    } catch (err) {
      setFiles((prev) => prev.map((f) => f.id === id ? { ...f, status: 'error', error: err.message } : f));
    }
  }, [files]);

  const compressAll = useCallback(() => {
    files.filter((f) => f.status === 'idle').forEach((f) => compressFile(f.id));
  }, [files, compressFile]);

  const removeFile = useCallback((id) => {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.downloadUrl) URL.revokeObjectURL(f.downloadUrl);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const idleCount = files.filter((f) => f.status === 'idle').length;
  const doneCount = files.filter((f) => f.status === 'done').length;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <FileText size={28} />
            <div>
              <h1>Comprimi PDF</h1>
              <p>Pronto para envio ao TCE-RJ · máx. {MAX_SIZE_MB}MB por arquivo</p>
            </div>
          </div>
          {health && (
            <div className={`health-badge ${health.status === 'ok' ? 'ok' : 'offline'}`}>
              {health.status === 'ok' ? (
                <>
                <CheckCircle size={14} /> Online
                {health.ghostscript ? ' · Ghostscript' : ''}
                {health.libreoffice ? ' · LibreOffice' : ''}
                {health.msword ? ' · Word' : ''}
                {!health.ghostscript && !health.libreoffice ? ' · Modo JS' : ''}
              </>
              ) : (
                <><XCircle size={14} /> Servidor offline</>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="main">
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        >
          <Upload size={40} className="drop-icon" />
          <p className="drop-title">Arraste arquivos ou clique para selecionar</p>
          <p className="drop-sub">PDF · DOC · DOCX · XLSX · PPTX · ODT · ODS · ODP</p>
          <label className="btn-primary">
            Selecionar Arquivos
            <input type="file" multiple accept={ACCEPTED} onChange={(e) => addFiles(e.target.files)} hidden />
          </label>
        </div>

        {files.length > 0 && (
          <section className="files-section">
            <div className="files-header">
              <h2>{files.length} arquivo{files.length !== 1 ? 's' : ''}</h2>
              <div className="files-actions">
                {doneCount > 0 && (
                  <span className="done-count">
                    <CheckCircle size={14} /> {doneCount} comprimido{doneCount !== 1 ? 's' : ''}
                  </span>
                )}
                {idleCount > 1 && (
                  <button className="btn-primary" onClick={compressAll}>
                    Comprimir todos ({idleCount})
                  </button>
                )}
              </div>
            </div>

            <div className="files-list">
              {files.map((f) => (
                <FileCard key={f.id} file={f} onRemove={removeFile} onCompress={compressFile} />
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        Arquivos processados localmente — nada enviado à nuvem
      </footer>
    </div>
  );
}

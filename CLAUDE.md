# Comprimi PDF — CLAUDE.md

## Propósito

Ferramenta web para comprimir PDF e arquivos Office (incluindo .doc legado) e empacotar em ZIP pronto para envio ao **TCE-RJ**, que aceita no máximo **80MB por arquivo**. Assinatura digital (token A3 ICP-Brasil) é feita separadamente no assinador oficial do TCE-RJ após o download do ZIP.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + Vite (porta 5173) |
| Backend | Node.js + Express 5 (porta 3333) |
| PDF | Ghostscript CLI (se instalado) → fallback pdf-lib |
| Office DOCX/XLSX/PPTX/OD* | JSZip + sharp (re-zip + compressão de imagens) |
| DOC legado | Microsoft Word COM (PowerShell) → fallback LibreOffice |
| ZIP final | JSZip |

## Estrutura

```
comprimi_pdf/
├── backend/
│   ├── compressors/
│   │   ├── pdf.js        — Ghostscript + fallback pdf-lib
│   │   ├── office.js     — Re-zip + sharp para DOCX/XLSX/PPTX/OD*
│   │   └── doc.js        — Word COM (PowerShell) + fallback LibreOffice
│   ├── index.js          — Express server, rotas, CORS, ZIP output
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx       — UI completa (drag-drop, progresso, download)
│   │   ├── App.css       — Estilos
│   │   └── index.css     — Reset
│   └── vite.config.js
└── README.md
```

## Como rodar

```bash
# Terminal 1 — backend
cd backend
node index.js

# Terminal 2 — frontend
cd frontend
npm run dev
```

URLs:
- Local: `http://localhost:5173`
- Rede: `http://172.16.8.4:5173` (IP da máquina servidora)

## Fluxo de compressão

```
Upload → detecta tipo → comprime → empacota ZIP → download
```

### PDF
1. Tenta Ghostscript (`-dPDFSETTINGS=/ebook`, 150dpi)
2. Se ainda > 80MB, tenta `/screen` (72dpi)
3. Fallback: pdf-lib (re-serialização com object streams)

### DOCX / XLSX / PPTX / ODT / ODS / ODP
1. JSZip extrai o arquivo (são ZIPs internamente)
2. sharp comprime todas as imagens embutidas (max 2000px, JPEG 75%)
3. JSZip reempacota com DEFLATE nível 9

### DOC (formato legado binário OLE2)
1. Detecta Microsoft Word via PowerShell COM → converte `.doc` → `.docx` silenciosamente (`Visible = false`)
2. Fallback: LibreOffice CLI (`soffice --convert-to docx`)
3. Se nenhum disponível: erro com instrução de instalação
4. Arquivo convertido passa pelo pipeline Office acima
5. Download entregue como `.docx` (não `.doc`)

## Saída

- Arquivo comprimido embalado em **ZIP**
- Nome: `{nome_original}_comprimido.zip`
- Arquivo dentro do ZIP: `{nome_original}_comprimido.{ext}`
- Header `X-Fits-TCE: true/false` indica se ZIP ≤ 80MB

## Formatos aceitos

`.pdf` `.doc` `.docx` `.xlsx` `.pptx` `.odt` `.ods` `.odp`

Limite de upload: **500MB**

## CORS

Middleware manual (não usa pacote `cors`) — permite qualquer origin (`*`).
Expõe headers customizados: `X-Compress-Ratio`, `X-Input-Size`, `X-Output-Size`, `X-Zip-Size`, `X-Engine`, `X-Fits-TCE`, `X-Zip-Name`, `X-Converted-To`.

## Dependências principais — backend

| Pacote | Uso |
|--------|-----|
| express ^5 | HTTP server |
| multer ^2 | Upload multipart |
| jszip | Leitura/escrita ZIP (office + ZIP final) |
| sharp | Compressão de imagens |
| pdf-lib | Fallback compressão PDF (pure JS) |
| libreoffice-convert | Fallback conversão .doc (wraps soffice CLI) |

## Variáveis de ambiente

| Var | Padrão | Descrição |
|-----|--------|-----------|
| `PORT` | `3333` | Porta do backend |

## Notas importantes

- **Porta 3001 ocupada** — outro serviço ("Portal de Transparência SEI - Nova Iguaçu") usa a porta 3001 nessa máquina. Backend usa 3333.
- **Ghostscript não instalado** — PDF comprime via pdf-lib (menor taxa de compressão). Instalar Ghostscript melhora significativamente resultados em PDF.
- **Word COM** detectado e funcional na máquina servidora — `.doc` converte silencioso em background via `WINWORD.EXE`.
- **Filenames com acentos** — `Content-Disposition` usa RFC 5987 (`filename*=UTF-8''...`) e `X-Zip-Name` é URL-encoded para evitar corrupção de caracteres especiais.
- **API_URL** no frontend usa `window.location.hostname` dinamicamente — funciona tanto em localhost quanto via IP de rede sem reconfiguração.
- Certificado digital é **A3 (token USB ICP-Brasil)** — assinatura feita externamente no assinador oficial TCE-RJ, não nesta ferramenta.

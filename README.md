# Comprimi PDF — TCE-RJ

Comprime PDF e arquivos Office para o limite de **80MB** exigido pelo TCE-RJ.

## Requisitos

- Node.js 18+
- (Opcional) [Ghostscript](https://www.ghostscript.com/download.html) instalado — melhora compressão de PDF significativamente

## Iniciar

### Backend (porta 3001)
```
cd backend
npm install
npm run dev
```

### Frontend (porta 5173)
```
cd frontend
npm install
npm run dev
```

Acesse: http://localhost:5173

## Formatos suportados

| Formato | Motor |
|---------|-------|
| PDF | Ghostscript (se instalado) ou pdf-lib |
| DOCX, XLSX, PPTX | Re-zip + compressão de imagens (sharp) |
| ODT, ODS, ODP | Re-zip + compressão de imagens (sharp) |

## Instalar Ghostscript (Windows)

Download em https://www.ghostscript.com/releases/gsdnld.html  
Instale e reinicie o backend — a rota `/health` confirma detecção.

(function(){
async function extractTextFromPdf(file, forceOcr=false){
const pdfjsLib = window.__pdfjsLib;
const buf = await file.arrayBuffer();
try{
const pdf = await pdfjsLib.getDocument({data: buf}).promise;
let all = '';
for(let p=1;p<=pdf.numPages;p++){
const page = await pdf.getPage(p);
const txt = await page.getTextContent();
const str = txt.items.map(it=>it.str).join('\n');
all += str + '\n';
}
const cleaned = all.replace(/[\s\n]+/g,'\n').trim();
if(!forceOcr && cleaned.length>20) return cleaned; // ある程度取れていれば採用
}catch(e){ /* テキスト抽出失敗 → OCRへ */ }


// OCR フォールバック
const imgBitmaps = await rasterizePdfToImages(buf);
let ocrText = '';
for(const bmp of imgBitmaps){
const res = await Tesseract.recognize(bmp, 'jpn', { logger: m=>console.debug('ocr',m) });
ocrText += (res.data.text||'') + '\n';
}
return ocrText;
}


// PDF→複数画像（bitmap）
async function rasterizePdfToImages(arrayBuf){
const pdfjsLib = window.__pdfjsLib;
const pdf = await pdfjsLib.getDocument({data: arrayBuf}).promise;
const outputs = [];
for(let p=1;p<=pdf.numPages;p++){
const page = await pdf.getPage(p);
const viewport = page.getViewport({ scale: 2.0 });
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
canvas.width = viewport.width; canvas.height = viewport.height;
await page.render({ canvasContext: ctx, viewport }).promise;
const bmp = await createImageBitmap(canvas);
outputs.push(bmp);
}
return outputs;
}


// テキスト→候補行
function splitCandidates(raw){
const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
// 長さやノイズでフィルタリング（調整可）
return lines.filter(s=>s.length>=3);
}


window.PWorldExtractor = { extractTextFromPdf, splitCandidates };
})();

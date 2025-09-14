<script type="module" id="__INLINE_ONLY_FOR_PREVIEW__app">
return union ? inter/union : 0;
}
function ngrams(s,n){
const xs=[]; const t = s; for(let i=0;i<t.length-(n-1);i++) xs.push(t.slice(i,i+n)); return xs;
}


function renderTable(rows){
tbody.innerHTML = rows.map((r,i)=>`
<tr>
<td>${i+1}</td>
<td>${escapeHtml(r.raw)}</td>
<td>${escapeHtml(r.normalized)}</td>
<td>${escapeHtml(r.matched_master||'')}</td>
<td>${r.score||''}</td>
<td>${r.method||''}</td>
</tr>
`).join('');
}


function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }


// ---- ダウンロード ----
dlCsvBtn.addEventListener('click', ()=>{
const header = ['raw','normalized','matched_master','score','method'];
const lines = [header.join(',')].concat(
resultsRows.map(r => header.map(k => `"${String(r[k]??'').replace(/"/g,'""')}"`).join(','))
);
const blob = new Blob([lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = `machines_${dateStamp()}.csv`;
a.click();
});


dlXlsxBtn.addEventListener('click', ()=>{
const header = ['raw','normalized','matched_master','score','method'];
const data = [header].concat(resultsRows.map(r => header.map(k => r[k]??'')));
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, 'Normalized');
XLSX.writeFile(wb, `machines_${dateStamp()}.xlsx`);
});


function dateStamp(){
const d=new Date();
const z=(n)=>String(n).padStart(2,'0');
return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
}
</script>


<!-- ============================
使い方（全店共通）
============================= -->
<!--
1) GitHub で新規リポジトリを作成（例: pworld-ocr）
2) 上記4ファイルをそのまま追加してコミット
- index.html
- styles.css（上の<style>の中身をコピペして保存）
- normalize.js（上の<script id=__INLINE_ONLY_FOR_PREVIEW__normalize>の中身）
- app.js（上の<script id=__INLINE_ONLY_FOR_PREVIEW__app>の中身）
3) Settings → Pages → Deploy from a branch → branch: main（/root）で保存
4) 表示されたPages URLを全系列に共有（例: https://yourname.github.io/pworld-ocr/）
5) 使い方：
- 店舗ページを開き、「設置機種」部分をスクショ（Windows: Win+Shift+S、Mac: Shift+Cmd+4）
もしくは印刷→PDF（対象ページのみ）
- Pagesのツールを開き、ファイルをドロップ→OCR実行→CSV/XLSXをダウンロード
6) （任意）機種マスターCSVをアップすると、自店のキー表記へ自動寄せ（あいまい一致）できます。


コツ：
- 画像は横幅1000px以上で撮ると精度が上がります（Retina OK）。
- OCR後に紛れがあれば、正規化テーブル（マスターCSV）に別名を追加→再実行でどんどん精度UP。
- 一括運用は、各店がダウンロードしたCSV/XLSXをあなたの集計ブックに貼り付けるだけで回せます。


必要になれば、PDF内の特定エリアだけを切り抜いてOCRするモードや、
店名/日付/レート等の自動認識カラムを追加する拡張版も作れます。
-->
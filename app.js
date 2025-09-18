(function(){
const uniq = new Set();
const matched = new Set();
const unmatched = new Set();


const masterLooseList = master.map(m=>m.loose);


for(const raw of lines){
const norm = NameNormalizer.normalizeName(raw);
const loose = NameNormalizer.makeLooseKey(raw);
if(!loose || uniq.has(loose)) continue; // 重複除去
uniq.add(loose);


// 1) ルーズキー完全一致
const idx = masterLooseList.indexOf(loose);
if(idx!==-1){
matched.add(master[idx].name);
continue;
}


// 2) ルーズ包含（短い方が含まれる）
let best = null;
for(const m of master){
if(m.loose.includes(loose) || loose.includes(m.loose)){
best = m; break;
}
}
if(best){ matched.add(best.name); continue; }


// 3) レーベンシュタイン距離で近いもの（しきい値は長さに応じて）
let minD = Infinity, near=null;
for(const m of master){
const d = levenshtein(loose, m.loose);
if(d < minD){ minD = d; near = m; }
}
const threshold = Math.max(2, Math.floor(Math.min(loose.length, (near?.loose.length||0)) * 0.12));
if(near && minD <= threshold){
matched.add(near.name);
}else{
unmatched.add(raw);
}
}
return { matched: Array.from(matched), unmatched: Array.from(unmatched) };
}


function levenshtein(a,b){
const m=a.length, n=b.length;
if(m===0) return n; if(n===0) return m;
const dp = Array.from({length:m+1},()=>new Array(n+1).fill(0));
for(let i=0;i<=m;i++) dp[i][0]=i;
for(let j=0;j<=n;j++) dp[0][j]=j;
for(let i=1;i<=m;i++){
for(let j=1;j<=n;j++){
const cost = a[i-1]===b[j-1]?0:1;
dp[i][j] = Math.min(
dp[i-1][j]+1, // 削除
dp[i][j-1]+1, // 挿入
dp[i-1][j-1]+cost // 置換
);
}
}
return dp[m][n];
}


// エクスポート
$('#btnExportCsv').addEventListener('click', ()=>{
const rows = matchedTA.value.split(/\r?\n/).filter(Boolean).map(v=>[v]);
downloadCsv(rows, 'machines_matched.csv');
});


$('#btnExportXlsx').addEventListener('click', ()=>{
const rows = matchedTA.value.split(/\r?\n/).filter(Boolean).map(v=>({機種名:v}));
const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '機種');
XLSX.writeFile(wb, 'machines_matched.xlsx');
});


function downloadCsv(rows, filename){
const header = '機種名\n';
const body = rows.map(r=> escapeCsv(r[0])).join('\n');
const blob = new Blob([header+body], {type:'text/csv;charset=utf-8;'});
const a = document.createElement('a');
a.href = URL.createObjectURL(blob); a.download = filename; a.click();
URL.revokeObjectURL(a.href);
}
function escapeCsv(s){
if(/[",\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
return s;
}
})();

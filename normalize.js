(function(){
const ZEN2HAN_MAP = {
'－':'-','ー':'-','‐':'-','―':'-','–':'-','—':'-',
'：':':','／':'/','（':'(','）':')','　':' ',
};


function toHalfWidth(str){
return str.replace(/[！-～]/g, s=>String.fromCharCode(s.charCodeAt(0)-0xFEE0))
.replace(/[％]/g,'%');
}


function replaceCommon(str){
return str.replace(/[\u2010-\u2015]/g,'-')
.replace(/[\u2212]/g,'-')
.replace(/[\u3000]/g,' ')
.replace(/[≪≫〈〉「」『』【】]/g,'')
.replace(/[™®©]/g,'');
}


function mapChars(str){
return str.replace(/[－ー‐―–—：／（）　]/g, ch => ZEN2HAN_MAP[ch] || ch);
}


function cleanSpaces(str){
return str.replace(/\s+/g,' ').trim();
}


function katakanaNormalize(str){
// 小書き・長音のゆれをある程度吸収
return str
.replace(/[ァィゥェォャュョヮ]/g, m => ({'ァ':'ア','ィ':'イ','ゥ':'ウ','ェ':'エ','ォ':'オ','ャ':'ヤ','ュ':'ユ','ョ':'ヨ','ヮ':'ワ'}[m]||m))
.replace(/ｯ/g,'ツ')
.replace(/ヵ/g,'カ').replace(/ヶ/g,'ケ');
}


function normalizeName(s){
if(!s) return '';
let out = s;
out = toHalfWidth(out);
out = replaceCommon(out);
out = mapChars(out);
out = cleanSpaces(out);
out = katakanaNormalize(out);
// 記号の削減（アルファ数値・かなカナ・漢字・記号一部のみ）
out = out.replace(/[^0-9A-Za-zぁ-んァ-ン一-龥\-\(\)・\s]/g,'');
// 連続ハイフンを1つに
out = out.replace(/\-+/g,'-');
return out;
}


// より粗い比較用のキー（空白と記号を除去）
function makeLooseKey(s){
return normalizeName(s).replace(/[\s\-・()]/g,'').toLowerCase();
}


window.NameNormalizer = { normalizeName, makeLooseKey };
})();

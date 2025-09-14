<script type="module" id="__INLINE_ONLY_FOR_PREVIEW__normalize">
// GitHubにアップするときは normalize.js として保存
export const dashNormalize = (s) => {
const map = ["‐","－","ー","―","一","–","—"]; let t = s;
for (const d of map) t = t.split(d).join("-"); return t;
};
export const normalizeName = (s) => {
if (!s) return "";
let t = s.normalize("NFKC");
t = dashNormalize(t);
t = t.replace(/[※☆★【】「」『』（）()［］\[\]]/g, "");
t = t.replace(/\s+/g, " ").trim();
return t;
};
</script>
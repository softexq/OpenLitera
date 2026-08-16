/* build-books-list.js — runs at deploy time (see vercel.json), not in the
   browser. Scans books/ for PDFs and audiobooks/ for audio files, writing
   books/books.json and audiobooks/audiobooks.json to match, so nothing
   needs hand-editing to add or remove a book or audiobook: just drop a
   file in the right folder (or delete one) and redeploy. The landing
   page's shelves (js/02-file-open-and-pages.js) just fetch those two
   manifests same as always — they have no idea whether a person or this
   script wrote them. */
const fs = require('fs');
const path = require('path');

function titleFromFilename(name, ext) {
  return name
    .replace(new RegExp('\\.' + ext + '$', 'i'), '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildManifest(folderName, extensions, extractExt) {
  const dir = path.join(__dirname, folderName);
  const manifestPath = path.join(dir, folderName + '.json');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const files = fs.readdirSync(dir)
    .filter(f => extensions.some(ext => f.toLowerCase().endsWith('.' + ext)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const list = files.map(file => {
    const ext = file.split('.').pop();
    return { file, title: titleFromFilename(file, ext) };
  });

  fs.writeFileSync(manifestPath, JSON.stringify(list, null, 2) + '\n');

  console.log(`${folderName}.json: found ${list.length} file(s) in ${folderName}/`);
  list.forEach(b => console.log(`  - ${b.file} -> "${b.title}"`));
  return list;
}

buildManifest('books', ['pdf']);
buildManifest('audiobooks', ['mp3', 'm4a', 'm4b', 'ogg', 'wav', 'aac', 'flac']);

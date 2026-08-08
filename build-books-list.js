/* build-books-list.js — runs at deploy time (see vercel.json), not in the
   browser. Scans books/ for PDFs and writes books/books.json to match, so
   nothing needs hand-editing to add or remove a book: just drop a PDF in
   books/ (or delete one) and redeploy. The landing page's bookshelf
   (js/02-file-open-and-pages.js) just fetches books/books.json same as
   always — it has no idea whether a person or this script wrote it. */
const fs = require('fs');
const path = require('path');

const booksDir = path.join(__dirname, 'books');
const manifestPath = path.join(booksDir, 'books.json');

function titleFromFilename(name) {
  return name
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

if (!fs.existsSync(booksDir)) fs.mkdirSync(booksDir, { recursive: true });

const files = fs.readdirSync(booksDir)
  .filter(f => f.toLowerCase().endsWith('.pdf'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const list = files.map(file => ({ file, title: titleFromFilename(file) }));

fs.writeFileSync(manifestPath, JSON.stringify(list, null, 2) + '\n');

console.log(`books.json: found ${list.length} PDF(s) in books/`);
list.forEach(b => console.log(`  - ${b.file} -> "${b.title}"`));

import { mkdir, copyFile, rm } from 'node:fs/promises';
const output = new URL('../dist/', import.meta.url);
const assets = ['index.html', 'app.js', 'styles.css', 'id-front.jpeg'];
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of assets) await copyFile(new URL(`../${file}`, import.meta.url), new URL(file, output));
console.log('Built four public assets. Server code and credentials are not in dist.');

import { mkdir, copyFile, readdir } from 'node:fs/promises';
const output = new URL('../dist/', import.meta.url);
const assets = ['index.html', 'portal.html', 'app.js', 'styles.css', 'id-front.jpeg'];
await mkdir(output, { recursive: true });
// Refuse an unexpected publish directory rather than accidentally exposing files.
const unexpected = (await readdir(output)).filter(name => !assets.includes(name));
if (unexpected.length) throw new Error('dist contains unexpected files. Review it before building.');
for (const file of assets) await copyFile(new URL(`../${file}`, import.meta.url), new URL(file, output));
console.log(`Built ${assets.length} public assets. Server code and credentials are not in dist.`);

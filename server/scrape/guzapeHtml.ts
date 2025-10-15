import got from 'got';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = 'https://propertypro.ng/index/sale/all/abuja/guzape';
const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36';

export async function fetchGuzapeRawHtml(): Promise<string> {
  await new Promise(r => setTimeout(r, 800 + Math.random()*400)); // small politeness delay
  let html = await got(SRC, {
    headers: { 'user-agent': UA, 'accept': 'text/html,*/*' },
    timeout: { request: 15000 },
    retry: { limit: 1 }
  }).text();
  
  // Fix relative URLs to absolute URLs for images, CSS, and JS
  html = html.replace(/src="\/assets\//g, 'src="https://propertypro.ng/assets/');
  html = html.replace(/href="\/assets\//g, 'href="https://propertypro.ng/assets/');
  html = html.replace(/src='\/assets\//g, "src='https://propertypro.ng/assets/");
  html = html.replace(/href='\/assets\//g, "href='https://propertypro.ng/assets/");
  
  return html;
}

export async function persistGuzapeHtml(html: string) {
  const outPath = path.resolve(process.cwd(), 'public', 'guzape.html');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, html, 'utf-8');
  return outPath;
}

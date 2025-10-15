import { fetchGuzapeRawHtml, persistGuzapeHtml } from '../server/scrape/guzapeHtml';

(async () => {
  const html = await fetchGuzapeRawHtml();
  const out = await persistGuzapeHtml(html);
  console.log('Wrote:', out);
})().catch(err => { console.error(err); process.exit(1); });

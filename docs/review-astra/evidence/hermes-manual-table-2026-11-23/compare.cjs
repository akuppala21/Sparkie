const fs = require('node:fs');
const { chromium } = require('/opt/browser/node_modules/playwright');
(async () => {
  const b = await chromium.launch({executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    const page = await b.newPage();
    const source = fs.readFileSync('/proof/original/source.html', 'utf8');
    const result = await page.evaluate((html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const program = [...doc.querySelectorAll('pre')].map(p => p.textContent)
        .find(p => p.includes('<td> 1 <td>   <td> 3'));
      if (!program) throw Error('Expected example is unavailable');
      const table = parser.parseFromString(program, 'text/html').querySelector('table');
      const cells = [...table.rows].map(r => [...r.cells].map(c => c.textContent.trim()));
      if (cells.length !== 9 || cells.some(r => r.length !== 9)) throw Error('Unexpected grid');
      return {program, cells};
    }, source);
    console.log(JSON.stringify(result));
  } finally { await b.close(); }
})().catch(e => {console.error(e);process.exitCode = 1});

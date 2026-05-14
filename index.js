const puppeteer = require('puppeteer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
    .option('searchUrl', {
        alias: 'u',
        type: 'string',
        description: 'Search result URL (e.g. "https://minimodel.jp/search?...(url)")',
        demandOption: true
    })
    .option('target', {
        alias: 't',
        type: 'string',
        description: 'Target username (e.g. "山田花子")',
        demandOption: true
    })
    .option('limit', {
        alias: 'l',
        type: 'number',
        description: 'Max pages to search (default: unlimited)',
        default: 0
    })
    .help()
    .argv;

(async () => {
    const searchUrl = argv.searchUrl;
    const target = argv.target;
    const limit = argv.limit;

    console.log(`Starting search for URL: "${searchUrl}"`);
    // 正規化されたターゲットユーザーネームを取得（絵文字や特殊文字、空白を除去）
    const normalizeText = (text) => {
        if (!text) return '';
        // 絵文字、特殊記号、空白を削除して小文字化
        return text.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|\s/g, '').toLowerCase();
    };

    const normalizedTarget = normalizeText(target);
    console.log(`Looking for target username: "${target}" (Normalized: "${normalizedTarget}")`);
    if (limit > 0) {
        console.log(`Page limit: ${limit}`);
    } else {
        console.log(`Page limit: Unlimited`);
    }

    const browser = await puppeteer.launch({
        headless: false, // Visible for user to see
        defaultViewport: null,
        args: ['--window-size=1280,800']
    });

    const page = await browser.newPage();

    try {
        console.log('Navigating to the specified search URL...');

        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        console.log(`Requested URL: ${searchUrl}`);

        await new Promise(r => setTimeout(r, 2000));

        // Handle potential overlays even on search page
        await page.evaluate(() => {
            const overlays = document.querySelectorAll('[class*="Modal"], [class*="Overlay"], [class*="Popup"]');
            overlays.forEach(el => el.remove());
        });


        let pageNum = 1;
        let globalRank = 0;
        let found = false;

        while (true) {
            if (limit > 0 && pageNum > limit) {
                console.log('Reached page limit. Target not found.');
                break;
            }

            console.log(`Checking page ${pageNum}...`);

            // リダイレクト等でフレームが破棄された場合のリトライ処理
            let selectorFound = false;
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                try {
                    await page.waitForSelector('.ArtistDetailCard_artsitDetailCardWrapper__24g3p, a.GTM_artist_detail_card__card, a[href*="/r/"]', { timeout: 15000 });
                    selectorFound = true;
                    break;
                } catch (e) {
                    if (e.message.includes('detached Frame') || e.message.includes('Execution context was destroyed')) {
                        console.log(`[Debug] Frame detached. Retrying... (${retryCount + 1}/${maxRetries})`);
                        await new Promise(r => setTimeout(r, 3000));
                        retryCount++;
                    } else {
                        console.log("No results found on this page.");
                        break;
                    }
                }
            }

            if (!selectorFound) {
                break;
            }

            // Extract items
            const items = await page.evaluate(() => {
                let cards = document.querySelectorAll('.ArtistDetailCard_artsitDetailCardWrapper__24g3p, a.GTM_artist_detail_card__card');
                if (cards.length === 0) {
                    cards = document.querySelectorAll('a[href*="/r/"]');
                }
                
                const result = [];
                const seenHrefs = new Set();
                
                cards.forEach(card => {
                    const aTag = card.tagName.toLowerCase() === 'a' ? card : card.querySelector('a[href*="/r/"]');
                    if (!aTag) return;
                    
                    const href = aTag.getAttribute('href');
                    if (!href || !href.includes('/r/') || seenHrefs.has(href)) return;
                    
                    seenHrefs.add(href);
                    
                    const staffEl = card.querySelector('[class*="profileName"], [class*="staffName"]');
                    const salonEl = card.querySelector('[class*="salonName"]');
                    
                    result.push({
                        href: href,
                        staff: staffEl ? staffEl.textContent.trim() : 'Unknown',
                        salon: salonEl ? salonEl.textContent.trim() : 'Unknown',
                        raw: card.innerText.replace(/\n+/g, ' ')
                    });
                });
                return result;
            });
            console.log(`Found ${items.length} items on page ${pageNum}.`);

            // Check for target
            for (let i = 0; i < items.length; i++) {
                globalRank++;
                const item = items[i];

                const normalizedStaff = normalizeText(item.staff);

                if (normalizedStaff && normalizedTarget && normalizedStaff.includes(normalizedTarget)) {
                    console.log('\n================================');
                    console.log(`✅ TARGET FOUND!`);
                    console.log(`Rank: ${globalRank}`);
                    console.log(`Page: ${pageNum}`);
                    console.log(`Staff: ${item.staff}`);
                    console.log(`Salon: ${item.salon}`);
                    console.log(`URL: ${item.href}`);
                    console.log('================================\n');
                    found = true;
                    break;
                }
            }

            if (found) break;

            // Pagination
            const nextButtonSelector = 'a[aria-label="次へ"]';
            const hasNext = await page.$(nextButtonSelector);

            if (hasNext) {
                console.log(`Target not found on page ${pageNum}. Moving to next page...`);

                // Click and wait for navigation
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                    page.click(nextButtonSelector)
                ]);
                pageNum++;
            } else {
                console.log('No more pages. Target not found.');
                break;
            }
        }

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        console.log('Closing browser...');
        await browser.close();
    }
})();

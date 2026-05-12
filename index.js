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
        description: 'Target profile URL (e.g. "https://minimodel.jp/r/pIg14Pr")',
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
    let targetProfileId = target;
    try {
        const urlObj = new URL(target);
        targetProfileId = urlObj.pathname;
    } catch (e) {}
    console.log(`Looking for target profile: "${targetProfileId}" (Original: "${target}")`);
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

            // Wait for results to load
            try {
                await page.waitForSelector('.ArtistDetailCard_artsitDetailCardWrapper__24g3p, a.GTM_artist_detail_card__card, a[href*="/r/"]', { timeout: 5000 });
            } catch (e) {
                console.log("No results found on this page.");
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

                if (item.href && item.href.includes(targetProfileId)) {
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

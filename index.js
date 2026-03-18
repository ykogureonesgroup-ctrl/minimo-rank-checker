const puppeteer = require('puppeteer');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
// テスト
const argv = yargs(hideBin(process.argv))
    .option('keyword', {
        alias: 'k',
        type: 'string',
        description: 'Search area keyword (e.g. "表参道")',
        demandOption: true
    })
    .option('prefecture', {
        alias: 'p',
        type: 'string',
        description: 'Prefecture name to filter suggestions (e.g. "東京都")',
        default: ''
    })
    .option('target', {
        alias: 't',
        type: 'string',
        description: 'Target name to find (staff or salon name)',
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
    const keyword = argv.keyword;
    const prefecture = argv.prefecture;
    const target = argv.target;
    const limit = argv.limit;

    console.log(`Starting search for area: "${keyword}"`);
    if (prefecture) {
        console.log(`Prefecture filter: "${prefecture}"`);
    }
    console.log(`Looking for target: "${target}"`);
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
        console.log('Navigating to minimodel.jp search page directly...');
        // Area keyword can be directly searched via URL query: /search?keyword=エリア名
        // Additionally we search for the specific target
        const searchQuery = encodeURIComponent(`${keyword} ${target}`);
        const searchUrl = `https://minimodel.jp/search?keyword=${searchQuery}`;

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
                await page.waitForSelector('.ArtistDetailCard_artsitDetailCardWrapper__24g3p', { timeout: 5000 });
            } catch (e) {
                console.log("No results found on this page.");
                break;
            }

            // Extract items
            const items = await page.evaluate(() => {
                const cards = document.querySelectorAll('.ArtistDetailCard_artsitDetailCardWrapper__24g3p');
                return Array.from(cards).map((card, index) => {
                    const staffEl = card.querySelector('.ArtistProfileWithExperienceYear_profileName__JXBzb');
                    const salonEl = card.querySelector('.ArtistProfileWithExperienceYear_salonName__4_e8k');
                    return {
                        staff: staffEl ? staffEl.textContent.trim() : '',
                        salon: salonEl ? salonEl.textContent.trim() : '',
                        raw: card.innerText // Fallback for fuzzy match
                    };
                });
            });
            console.log(`Found ${items.length} items on page ${pageNum}.`);

            // Check for target
            for (let i = 0; i < items.length; i++) {
                globalRank++;
                const item = items[i];
                const normalizedTarget = target.replace(/\s+/g, '');
                const normalizedStaff = item.staff.replace(/\s+/g, '');
                const normalizedSalon = item.salon.replace(/\s+/g, '');
                const normalizedRaw = item.raw.replace(/\s+/g, '');

                if (normalizedStaff.includes(normalizedTarget) || normalizedSalon.includes(normalizedTarget) || normalizedRaw.includes(normalizedTarget)) {
                    console.log('\n================================');
                    console.log(`✅ TARGET FOUND!`);
                    console.log(`Rank: ${globalRank}`);
                    console.log(`Page: ${pageNum}`);
                    console.log(`Staff: ${item.staff}`);
                    console.log(`Salon: ${item.salon}`);
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

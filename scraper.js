const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function runSearch(options) {
    const { keyword, prefecture, target, limit, onLog } = options;

    const log = (msg) => {
        console.log(msg);
        if (onLog) onLog(msg);
    };

    log(`Starting search for area: "${keyword}"`);
    if (prefecture) {
        log(`Prefecture filter: "${prefecture}"`);
    }
    log(`Looking for target: "${target}"`);
    if (limit > 0) {
        log(`Page limit: ${limit}`);
    } else {
        log(`Page limit: Unlimited`);
    }

    const browser = await puppeteer.launch({
        headless: "new", // Run in background for web app
        defaultViewport: null,
        args: [
            '--window-size=1280,800', 
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Critical for Docker/Render
            '--disable-gpu',
            '--no-zygote',
            '--single-process',
            '--disable-blink-features=AutomationControlled'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null // Use system chrome if in docker
    });

    const page = await browser.newPage();
    
    // Set realistic User-Agent for headless mode (Force Desktop)
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });
    
    // Increase default timeout slightly for cold boots
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    // Block Images and Fonts to save memory on Render
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (request.isInterceptResolutionHandled()) return;
        const resourceType = request.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
            request.abort().catch(() => {});
        } else {
            request.continue().catch(() => {});
        }
    });

    try {
        log('Navigating to minimodel.jp search page directly...');
        // Area keyword can be directly searched via URL query: /search?keyword=エリア名
        // Additionally we search for the specific target
        const searchQuery = encodeURIComponent(`${keyword} ${target}`);
        const searchUrl = `https://minimodel.jp/search?keyword=${searchQuery}`;
        
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        log(`Requested URL: ${searchUrl}`);

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
                log('====== SEARCH COMPLETED ======');
                log('Reached page limit. Target not found.');
                break;
            }

            log(`Checking page ${pageNum}...`);

            try {
                await page.waitForSelector('.ArtistDetailCard_artsitDetailCardWrapper__24g3p', { timeout: 5000 });
            } catch (e) {
                log("====== SEARCH COMPLETED ======");
                log("No results found on this page or end of results reached.");
                break;
            }

            const items = await page.evaluate(() => {
                const cards = document.querySelectorAll('.ArtistDetailCard_artsitDetailCardWrapper__24g3p');
                return Array.from(cards).map((card, index) => {
                    const staffEl = card.querySelector('.ArtistProfileWithExperienceYear_profileName__JXBzb');
                    const salonEl = card.querySelector('.ArtistProfileWithExperienceYear_salonName__4_e8k');
                    return {
                        staff: staffEl ? staffEl.textContent.trim() : '',
                        salon: salonEl ? salonEl.textContent.trim() : '',
                        raw: card.innerText
                    };
                });
            });
            
            log(`Found ${items.length} items on page ${pageNum}.`);

            for (let i = 0; i < items.length; i++) {
                globalRank++;
                const item = items[i];
                const normalizedTarget = target.replace(/\s+/g, '');
                const normalizedStaff = item.staff.replace(/\s+/g, '');
                const normalizedSalon = item.salon.replace(/\s+/g, '');
                const normalizedRaw = item.raw.replace(/\s+/g, '');

                if (normalizedStaff.includes(normalizedTarget) || normalizedSalon.includes(normalizedTarget) || normalizedRaw.includes(normalizedTarget)) {
                    log('\n================================');
                    log(`✅ TARGET FOUND!`);
                    log(`Rank: ${globalRank}`);
                    log(`Page: ${pageNum}`);
                    log(`Staff: ${item.staff}`);
                    log(`Salon: ${item.salon}`);
                    log('================================\n');
                    log('====== SEARCH COMPLETED ======');
                    found = true;
                    break;
                }
            }

            if (found) break;

            const nextButtonSelector = 'a[aria-label="次へ"]';
            const hasNext = await page.$(nextButtonSelector);

            if (hasNext) {
                log(`Target not found on page ${pageNum}. Moving to next page...`);

                const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                await page.click(nextButtonSelector);
                await navPromise;
                await new Promise(r => setTimeout(r, 2000)); // Buffer for SPA routing
                pageNum++;
            } else {
                log('====== SEARCH COMPLETED ======');
                log('No more pages. Target not found.');
                break;
            }
        }

    } catch (error) {
        log(`ERROR: ${error.message}`);
    } finally {
        log('Closing browser...');
        await browser.close();
        log('Browser closed.');
    }
}

module.exports = { runSearch };

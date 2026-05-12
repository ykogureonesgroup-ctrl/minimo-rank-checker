const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function runSearch(options) {
    const { searchUrl, target, limit, onLog } = options;

    const log = (msg) => {
        console.log(msg);
        if (onLog) onLog(msg);
    };

    log(`Starting search for URL: "${searchUrl}"`);
    
    // Extract the profile ID (e.g. /r/pIg14Pr) from the target URL
    let targetProfileId = target;
    try {
        const urlObj = new URL(target);
        targetProfileId = urlObj.pathname; // Should be like "/r/pIg14Pr"
    } catch (e) {
        // If it's not a valid URL, fallback to the string as is
    }
    log(`Looking for target profile: "${targetProfileId}" (Original input: "${target}")`);
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
    
    // Removed fixed User-Agent to allow stealth plugin to use the actual browser's UA
    // which prevents Cloudflare version mismatch detection.
    await page.setViewport({ width: 1280, height: 800 });
    
    // Increase default timeout slightly for cold boots
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    // Re-enable Request Interception to prevent Out of Memory (OOM) crashes on Render ("Target closed").
    // We allow stylesheets/scripts to load cleanly, but block images/fonts/media which consume >100MB RAM.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (request.isInterceptResolutionHandled()) return;
        const resourceType = request.resourceType();
        if (['image', 'font', 'media'].includes(resourceType)) {
            request.abort('aborted').catch(() => {});
        } else {
            request.continue().catch(() => {});
        }
    });


    try {
        log('Navigating to the specified search URL...');
        
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        log(`Requested URL: ${searchUrl}`);

        await new Promise(r => setTimeout(r, 2000));
        
        // Handle potential overlays even on search page
        try {
            await page.evaluate(() => {
                const overlays = document.querySelectorAll('[class*="Modal"], [class*="Overlay"], [class*="Popup"]');
                overlays.forEach(el => el.remove());
            });
        } catch (e) {
            log(`Warning: Could not clear overlays (usually because page redirected): ${e.message}`);
        }

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
                // Wait for either the old card class or the new card class or any profile link
                await page.waitForSelector('.ArtistDetailCard_artsitDetailCardWrapper__24g3p, a.GTM_artist_detail_card__card, a[href*="/r/"]', { timeout: 15000 });
            } catch (e) {
                const title = await page.title().catch(() => 'Unknown title');
                log(`[Debug] Page title at error: ${title}`);
                log(`[Debug] waitForSelector error: ${e.message}`);
                log("====== SEARCH COMPLETED ======");
                log("No results found on this page or end of results reached.");
                break;
            }

            let items = [];
            try {
                items = await page.evaluate(() => {
                    // Try different possible selectors for the card
                    let cards = document.querySelectorAll('.ArtistDetailCard_artsitDetailCardWrapper__24g3p, a.GTM_artist_detail_card__card');
                    
                    // Fallback to just finding profile links if specific classes aren't found
                    if (cards.length === 0) {
                        cards = document.querySelectorAll('a[href*="/r/"]');
                    }
                    
                    const result = [];
                    const seenHrefs = new Set();
                    
                    cards.forEach(card => {
                        // The card itself might be an <a> tag, or it might contain an <a> tag
                        const aTag = card.tagName.toLowerCase() === 'a' ? card : card.querySelector('a[href*="/r/"]');
                        if (!aTag) return;
                        
                        const href = aTag.getAttribute('href');
                        // Exclude non-profile links
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
            } catch (e) {
                log(`Warning: Failed to evaluate items on page ${pageNum} (${e.message}). Retrying...`);
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            
            log(`Found ${items.length} items on page ${pageNum}.`);

            for (let i = 0; i < items.length; i++) {
                globalRank++;
                const item = items[i];
                
                // Check if the item's href includes the target profile ID
                if (item.href && item.href.includes(targetProfileId)) {
                    log('\n================================');
                    log(`✅ TARGET FOUND!`);
                    log(`Rank: ${globalRank}`);
                    log(`Page: ${pageNum}`);
                    log(`Staff: ${item.staff}`);
                    log(`Salon: ${item.salon}`);
                    log(`URL: ${item.href}`);
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

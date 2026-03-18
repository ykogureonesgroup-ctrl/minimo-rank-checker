const express = require('express');
const path = require('path');
const { runSearch } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Server-Sent Events endpoint for real-time scraping logs
app.get('/api/search', async (req, res) => {
    // Keep connection open
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const keyword = req.query.keyword;
    const prefecture = req.query.prefecture || '';
    const target = req.query.target;
    // Handle limit which might be passed as string '0' or 'unlimited'
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 0) limit = 0;

    if (!keyword || !target) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Keyword and target are required' })}\n\n`);
        res.end();
        return;
    }

    // Helper to send logs to client via SSE
    const onLog = (msg) => {
        // SSE format: "data: {JSON}\n\n"
        res.write(`data: ${JSON.stringify({ type: 'log', message: msg })}\n\n`);
        
        // Let the client know the search has completed
        if (msg.includes('====== SEARCH COMPLETED ======') || msg.includes('ERROR:')) {
            // Give a bit of time for logs to flush before ending connection
            setTimeout(() => {
                res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                res.end();
            }, 500);
        }
    };

    try {
        // Run the Puppeteer scraping logic
        await runSearch({
            keyword,
            prefecture,
            target,
            limit,
            onLog
        });
    } catch (error) {
        onLog(`ERROR: Unhandled error in scraper: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`Web app is running at http://localhost:${PORT}`);
});

const puppeteer = require('puppeteer');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const BASE_URL = 'https://www.pmkaubamaja.ee/fi/maatalouskoneiden-varaosat.html?p=1';

(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const { collection: productsCollection } = await connectToDatabase();
    console.log('[Connected to MongoDB]');

    let currentPageUrl = BASE_URL;
    let hasNextPage = true;
    let allProducts = [];

    while (hasNextPage) {
        console.log(`🔍 Scraping page: ${currentPageUrl}`);
        await page.goto(currentPageUrl, { waitUntil: 'load', timeout: 0 });

        // Extract product links
        const productLinks = await page.$$eval('h2.product-name a', links => links.map(link => link.href));
        console.log(`🔗 Found ${productLinks.length} product links.`);

        for (const link of productLinks) {
            console.log(`🛂 Scraping product: ${link}`);
            await page.goto(link, { waitUntil: 'load', timeout: 0 });

            const product = await page.evaluate(() => {
                const name = document.querySelector('h1')?.innerText.trim() || '';
                const price = document.querySelector('.price')?.innerText.trim() || '';
                const sku = document.querySelector('.sku')?.innerText.trim() || '';
                const description = document.querySelector('.std')?.innerText.trim() || '';

                return { name, price, sku, description, link: window.location.href };
            });

            allProducts.push(product);

            if (allProducts.length >= 10) {
                console.log(`💾 Inserting ${allProducts.length} products into the database...`);
                await insertProductsBatch(allProducts, productsCollection);
                allProducts = []; // Reset buffer
            }
        }

        // Check for the next page button
        const nextPageElement = await page.$('a.next.i-next');
        hasNextPage = nextPageElement !== null;
        if (hasNextPage) {
            currentPageUrl = await page.evaluate(el => el.href, nextPageElement);
        }
    }

    // Insert remaining products
    if (allProducts.length > 0) {
        console.log(`💾 Inserting final ${allProducts.length} products into the database...`);
        await insertProductsBatch(allProducts, productsCollection);
    }

    console.log('✅ Scraping finished');
    await browser.close();
    await closeDatabase();
})();

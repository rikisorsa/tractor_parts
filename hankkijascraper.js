const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const logFile = fs.createWriteStream('scraper.log', { flags: 'a' }); // Append mode
const log = (message) => logFile.write(`${new Date().toISOString()} - ${message}\n`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeProducts = async (url, collection) => {
    log(`Scraping products from: ${url}`);
    const productsBatch = [];

    try {
        const response = await axios.get(url, {
            headers: { 'Accept-Encoding': 'gzip, deflate, br' },
        });
        const $ = cheerio.load(response.data);

        $('meta[property="og:url"]').each((_, el) => {
            const productLink = $(el).attr('content');
            const name = $('meta[property="og:title"]').attr('content');
            const oemNumber = $('meta[property="og:description"]').attr('content');
            const priceText = $('#spanIsohintaTuotekortti').text().trim();
            const price = parseFloat(priceText.replace(',', '.')) || null;

            if (name && productLink && oemNumber) {
                const product = {
                    name,
                    oemNumbers: oemNumber,
                    price,
                    link: productLink,
                    site: 'Hankkija',
                    scrapedDate: new Date().toLocaleString('en-GB', {
                        timeZone: 'Europe/Helsinki',
                        hour12: false,
                    }),
                };
                log(`Extracted product: ${JSON.stringify(product)}`);
                productsBatch.push(product);
            }
        });

        if (productsBatch.length > 0) {
            log(`Extracted ${productsBatch.length} products from ${url}`);
            await insertProductsBatch(productsBatch, collection);
        } else {
            log(`No products found on page: ${url}`);
        }
    } catch (error) {
        log(`Error scraping products from ${url}: ${error.message}`);
    }
};

const scrapeHankkijaRecursively = async (initialUrl, collection, maxDepth = 5, visited = new Set()) => {
    const urlsToVisit = [{ url: initialUrl, depth: 0 }];
    let pagesScraped = 0;

    while (urlsToVisit.length > 0) {
        const { url, depth } = urlsToVisit.pop();

        if (visited.has(url)) {
            log(`Skipping already visited URL: ${url}`);
            continue;
        }
        if (depth > maxDepth) {
            log(`Skipping URL due to max depth: ${url}`);
            continue;
        }

        visited.add(url);
        pagesScraped++;

        log(`Scraping sublinks from: ${url}, depth: ${depth}`);
        log(`Pages scraped so far: ${pagesScraped}, Pages left in queue: ${urlsToVisit.length}`);

        try {
            const response = await axios.get(url, {
                headers: { 'Accept-Encoding': 'gzip, deflate, br' },
            });
            const $ = cheerio.load(response.data);

            if ($('meta[property="og:url"]').length > 0) {
                await scrapeProducts(url, collection);
            }

            $('a').each((_, el) => {
                const href = $(el).attr('href');
                if (
                    href &&
                    href.startsWith('/varaosat-ja-tarvikkeet/') &&
                    !href.includes('/ajankohtaista/') &&
                    !href.includes('/campaign/') &&
                    !visited.has(`https://www.hankkija.fi${href}`)
                ) {
                    const fullUrl = `https://www.hankkija.fi${href}`;
                    urlsToVisit.push({ url: fullUrl, depth: depth + 1 });
                    log(`Added to queue: ${fullUrl}`);
                }
            });

            await sleep(2000);
        } catch (error) {
            log(`Error scraping sublinks from ${url}: ${error.message}`);
        }
    }

    log(`Finished scraping. Total pages scraped: ${pagesScraped}`);
};


const main = async () => {
    const { collection } = await connectToDatabase();

    try {
        const initialUrl = 'https://www.hankkija.fi/varaosat-ja-tarvikkeet/';
        await scrapeHankkijaRecursively(initialUrl, collection);
    } catch (error) {
        log(`Error during scraping: ${error.message}`);
    } finally {
        await closeDatabase();
        log('MongoDB connection closed.');
        logFile.end(); // Close the log file when finished
    }
};

main();

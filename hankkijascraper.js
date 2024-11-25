const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const logFile = fs.createWriteStream('scraper.log', { flags: 'a' }); // Append mode
const log = (message) => logFile.write(`${new Date().toISOString()} - ${message}\n`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeProducts = async (url, collection) => {
    log(`Scraping product details from: ${url}`);
    const productsBatch = [];

    try {
        const response = await axios.get(url, {
            headers: { 'Accept-Encoding': 'gzip, deflate, br' },
        });
        const $ = cheerio.load(response.data);

        // Extract product details
        const name = $('h1.product-name').text().trim();

        // Extract OEM numbers
        const oemNumbers = [];
        $('b:contains("OEM-numero")').each((_, el) => {
            const oemText = $(el).text().replace('OEM-numero', '').trim();
            if (oemText) oemNumbers.push(oemText);
        });

        // Extract price
        let priceText = $('#spanIsohintaTuotekortti').text().trim(); // Default price
        if (!priceText) {
            priceText = $('div.price .price-amount').text().trim(); // Fallback price
        }
        if (!priceText) {
            priceText = $('span.price-amount').text().trim(); // General fallback
        }

        // Clean up and parse price
        if (priceText) {
            priceText = priceText.replace(',', '.'); // Convert comma to dot
        }
        const price = parseFloat(priceText) || null;

        // Debugging missing prices
        if (price === null) {
            console.log('Price extraction failed for URL:', url);
            console.log('Price text:', priceText);
            console.log('Raw HTML:', $('div.h2').html()); // Adjust selector as needed
        }

        // Extract compatible data
        const compatible = [];
        $('.compatible-items__row').each((_, row) => {
            const type = $(row).find('.compatible-items__type').text().trim();
            const make = $(row).find('.compatible-items__make').text().trim();
            const models = [];
            $(row)
                .find('.compatible-items__model')
                .each((_, model) => {
                    models.push($(model).text().trim());
                });

            if (type && make && models.length > 0) {
                compatible.push({ type, make, models });
            }
        });

        // Build product object
        if (name) {
            const product = {
                name,
                oemNumbers: oemNumbers.length > 0 ? oemNumbers : null,
                price,
                link: url,
                site: 'Hankkija',
                compatible: compatible.length > 0 ? compatible : null,
                scrapedDate: new Date().toLocaleString('en-GB', {
                    timeZone: 'Europe/Helsinki',
                    hour12: false,
                }),
            };

            console.log('Extracted product:', product);
            log(`Extracted product: ${JSON.stringify(product)}`);
            productsBatch.push(product);
        }

        // Insert products into database
        if (productsBatch.length > 0) {
            log(`Extracted ${productsBatch.length} products from ${url}`);
            await insertProductsBatch(productsBatch, collection);
            console.log('Stored products:', productsBatch);
        } else {
            log(`No valid product data found on page: ${url}`);
            console.log(`No valid product data found on page: ${url}`);
        }
    } catch (error) {
        log(`Error scraping product details from ${url}: ${error.message}`);
        console.error(`Error scraping product details from ${url}:`, error.message);
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

            // Scrape current page for products
            if ($('meta[property="og:url"]').length > 0) {
                await scrapeProducts(url, collection);
            }

            // Extract and queue valid sublinks
            $('a').each((_, el) => {
                const href = $(el).attr('href');
                if (
                    href &&
                    href.startsWith('/varaosat-ja-tarvikkeet/') && // Keep only valid product links
                    !visited.has(`https://www.hankkija.fi${href}`) // Avoid revisiting links
                ) {
                    const fullUrl = `https://www.hankkija.fi${href}`;
                    urlsToVisit.push({ url: fullUrl, depth: depth + 1 });
                    log(`Added to queue: ${fullUrl}`);
                }
            });

            await sleep(2000); // Throttle requests to avoid being blocked
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

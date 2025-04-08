// hankkijascraper.js - Puppeteer-integrated version (fixed browser sharing + tab cleanup)

const fs = require('fs');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const logFile = fs.createWriteStream('scraper.log', { flags: 'a' });
const log = (message) => logFile.write(`${new Date().toISOString()} - ${message}\n`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeProducts = async (url, collection, browser) => {
    log(`Scraping product details from: ${url}`);
    const productsBatch = [];

    let page;
    try {
        page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        const name = await page.$eval('h1.product-name', el => el.textContent.trim()).catch(() => null);

        const oemNumbers = await page.$$eval('b', elements => {
            return elements
                .filter(el => el.textContent.includes('OEM-numero'))
                .map(el => el.textContent.replace('OEM-numero', '').trim());
        });

        let price = await page.$eval('#spanIsohintaTuotekortti', el => el.textContent.trim())
            .then(text => parseFloat(text.replace(/\s/g, '').replace(',', '.')))
            .catch(() => null);

        if (!price) {
            price = await page.$eval('button.add-to-cart[data-hn]', btn =>
                parseFloat(btn.getAttribute('data-hn'))
            ).catch(() => null);
        }

        const compatible = await page.$$eval('.compatible-items__row', rows => {
            return rows.map(row => {
                const type = row.querySelector('.compatible-items__type')?.textContent.trim();
                const make = row.querySelector('.compatible-items__make')?.textContent.trim();
                const models = Array.from(row.querySelectorAll('.compatible-items__model'))
                    .map(m => m.textContent.trim());
                return type && make && models.length > 0 ? { type, make, models } : null;
            }).filter(Boolean);
        });

        if (name) {
            const product = {
                name,
                oemNumbers: oemNumbers.length > 0 ? oemNumbers : null,
                price,
                link: url,
                site: 'Hankkija',
                country: ['FIN'],
                compatible: compatible.length > 0 ? compatible : null,
                scrapedDate: new Date().toLocaleString('en-GB', {
                    timeZone: 'Europe/Helsinki', hour12: false,
                }),
            };

            console.log('Extracted product:', product);
            log(`Extracted product: ${JSON.stringify(product)}`);
            productsBatch.push(product);
        }

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
    } finally {
        if (page) await page.close();
    }
};

const scrapeHankkijaRecursively = async (initialUrl, collection, browser, maxDepth = 5, visited = new Set()) => {
    const urlsToVisit = [{ url: initialUrl, depth: 0 }];
    let pagesScraped = 0;

    while (urlsToVisit.length > 0) {
        const { url, depth } = urlsToVisit.pop();

        if (visited.has(url) || depth > maxDepth) continue;

        visited.add(url);
        pagesScraped++;
        log(`Scraping sublinks from: ${url}, depth: ${depth}`);

        let page;
        try {
            page = await browser.newPage();        
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            const html = await page.content();
            const $ = cheerio.load(html);

            // Only scrape product pages
            if ($('meta[property="og:url"]').length > 0 && $('h1.product-name').length > 0) {
                await scrapeProducts(url, collection, browser);
            }

            $('a').each((_, el) => {
                const href = $(el).attr('href');
                if (href && href.startsWith('/varaosat-ja-tarvikkeet/')) {
                    const fullUrl = `https://www.hankkija.fi${href}`;
                    if (!visited.has(fullUrl)) {
                        urlsToVisit.push({ url: fullUrl, depth: depth + 1 });
                    }
                }
            });

            await sleep(2000);
        } catch (error) {
            log(`Error scraping sublinks from ${url}: ${error.message}`);
        } finally {
            if (page) await page.close();
        }
    }

    log(`Finished scraping. Total pages scraped: ${pagesScraped}`);
};

const main = async () => {
    const { collection } = await connectToDatabase();
    const browser = await puppeteer.launch({ headless: true });

    try {
        const initialUrl = 'https://www.hankkija.fi/varaosat-ja-tarvikkeet/';
        await scrapeHankkijaRecursively(initialUrl, collection, browser);
    } catch (error) {
        log(`Error during scraping: ${error.message}`);
    } finally {
        await browser.close();
        await closeDatabase();
        log('MongoDB connection closed.');
        logFile.end();
    }
};

main();

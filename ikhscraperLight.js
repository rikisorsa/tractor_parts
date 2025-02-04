const puppeteer = require('puppeteer');
const fs = require('fs');
const { connectToDatabase, closeDatabase } = require('./dbutils');

const baseUrl = 'https://www.ikh.fi/fi/varaosat/traktori?p=';
const maxPages = 100;
const logFilePath = '/log/ikh_updates.log';

const logUpdate = (message) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFilePath, logEntry);
};

const scrapeIKHLight = async () => {
    console.log('Starting IKH Light scraper with Puppeteer...');
    const { collection: productsCollection, db } = await connectToDatabase();
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    let currentPage = 1;

    while (currentPage <= maxPages) {
        const url = `${baseUrl}${currentPage}`;
        console.log(`Scraping page: ${currentPage}, URL: ${url}`);

        try {
            await page.goto(url, { waitUntil: 'networkidle2' });

            // Extract product details
            const products = await page.evaluate(() => {
                let results = [];
                document.querySelectorAll('.product-item-info').forEach(item => {
                    let name = item.querySelector('.product-item-link')?.innerText.trim() || null;
                    let link = item.querySelector('.product-item-link')?.href || null;
                    let price = item.querySelector('.price')?.innerText.trim() || null;
                    let availability = item.querySelector('button.action.tocart.primary') ? 'In Stock' :
                                      item.querySelector('div.stock.unavailable') ? 'Out of Stock' : 'Unknown';
                    
                    if (name && link) {
                        results.push({ name, link, price, availability });
                    }
                });
                return results;
            });

            console.log(`✅ Found ${products.length} products on page ${currentPage}`);

            for (const product of products) {
                const existingProduct = await productsCollection.findOne({ name: product.name, site: 'IKH' });

                if (existingProduct) {
                    let updates = {};
                    if (existingProduct.price !== product.price) {
                        updates.price = product.price;
                    }
                    if (existingProduct.availability !== product.availability) {
                        updates.availability = product.availability;
                    }

                    if (Object.keys(updates).length > 0) {
                        await productsCollection.updateOne(
                            { name: product.name, site: 'IKH' },
                            { $set: updates }
                        );
                        logUpdate(`Updated: ${product.name} | ${JSON.stringify(updates)}`);
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Error scraping page ${currentPage}:`, error.message);
            break;
        }

        currentPage++;
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await browser.close();
    await closeDatabase();
    console.log('✅ Scraping complete!');
};

scrapeIKHLight();

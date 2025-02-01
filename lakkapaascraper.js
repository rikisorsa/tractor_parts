const puppeteer = require('puppeteer');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const baseUrl = 'https://www.lakkapaa.com/fi/maatalous-ja-konekauppa/koneiden-osat-ja-tarvikkeet/c/655/';

const scrapeLakkapaa = async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle2' });
    
    console.log('Starting Lakkapaa scraper...');
    await page.waitForSelector('.ProductCard__product-data-wrapper');

    let currentPage = 1;
    const totalPages = await page.evaluate(() => {
        const paginationElements = document.querySelectorAll('.pagination li a');
        const lastPageElement = paginationElements[paginationElements.length - 2]; // Second to last element should be the last page number
        return lastPageElement ? parseInt(lastPageElement.textContent.trim()) : 1;
    });
    

    console.log(`Detected total pages: ${totalPages}`);

    const { collection: productsCollection, db } = await connectToDatabase();
    
    while (currentPage <= totalPages) {
        console.log(`Scraping page: ${currentPage}/${totalPages}, URL: ${baseUrl}?page=${currentPage}`);
        await page.goto(`${baseUrl}?page=${currentPage}`, { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('.ProductCard__product-data-wrapper');
        
        const productsBatch = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.ProductCard__product-data-wrapper')).map(element => {
                const productName = element.querySelector('h2')?.textContent.trim() || null;
                const productLink = element.querySelector('a.ProductLink')?.href || null;
                const model = element.querySelector('.ProductCard__model')?.textContent.trim() || null;
                const description = element.querySelector('.ProductDescription')?.textContent.trim() || null;
                const price = element.querySelector('span.Price--discount .Price--amount-wrapper')?.textContent.trim() || 
                              element.querySelector('span.Price--muted .Price--amount-wrapper')?.textContent.trim() || null;
                const availability = element.querySelector('.multistorage-stock-text')?.textContent.trim() || null;
                return {
                    name: productName,
                    model: model,
                    price: price,
                    link: productLink ? `https://www.lakkapaa.com${productLink}` : null,
                    availability: availability,
                    site: 'Lakkapaa',
                    scrapedDate: new Date().toLocaleString('en-GB', { timeZone: 'Europe/Helsinki', hour12: false }),
                };
            });
        });

        console.log(`✅ Found ${productsBatch.length} products on page ${currentPage}`);

        if (productsBatch.length > 0) {
            await insertProductsBatch(productsBatch, productsCollection);
        }
        
        currentPage++;
        await new Promise(resolve => setTimeout(resolve, 2000));

    }

    await browser.close();
    await closeDatabase();
    console.log('✅ Scraping complete!');
};

scrapeLakkapaa();

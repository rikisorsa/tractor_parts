const axios = require('axios');
const cheerio = require('cheerio');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const baseUrl = 'https://www.ikh.fi/fi/varaosat/traktori?p=';
const maxPages = 100; // Adjust based on the actual number of pages

const scrapeIKHLight = async () => {
    console.log('Starting IKH Light scraper...');
    
    const { collection: productsCollection, db } = await connectToDatabase();
    let currentPage = 1;
    
    while (currentPage <= maxPages) {
        const url = `${baseUrl}${currentPage}`;
        console.log(`Scraping page: ${currentPage}, URL: ${url}`);
        
        try {
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);
            
            const productsBatch = [];
            
            $('.product-item-info').each((_, element) => {
                const productElement = $(element);
                const productName = productElement.find('a.product-item-link').text().trim();
                const productLink = productElement.find('a.product-item-link').attr('href');
                const oemNumbers = productElement.find('.product-item-sku').text().trim() || null;
                const price = productElement.find('.price.price-with-unit').text().trim() || null;
                
                let availability = 'Unknown';
                if (productElement.find('button.action.tocart.primary').length > 0) {
                    availability = 'In Stock';
                } else if (productElement.find('.stock.unavailable').length > 0) {
                    availability = 'Out of Stock';
                }
                
                productsBatch.push({
                    name: productName,
                    oemNumbers: oemNumbers,
                    price: price,
                    link: productLink || null,
                    availability: availability,
                    site: 'IKH',
                    country: ['FIN'],
                    scrapedDate: new Date().toLocaleString('en-GB', { timeZone: 'Europe/Helsinki', hour12: false }),
                });
            });
            
            console.log(`✅ Found ${productsBatch.length} products on page ${currentPage}`);
            
            if (productsBatch.length > 0) {
                await insertProductsBatch(productsBatch, productsCollection);
            } else {
                console.log('❌ No products found, stopping scraper.');
                break;
            }
        } catch (error) {
            console.error(`❌ Error scraping page ${currentPage}:`, error.message);
            break;
        }
        
        currentPage++;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Prevent rate limiting
    }
    
    await closeDatabase();
    console.log('✅ Scraping complete!');
};

scrapeIKHLight();

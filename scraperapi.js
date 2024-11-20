const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'tractorPartsDB';
const collectionName = 'IKH';

(async () => {
    try {
        // Connect to MongoDB
        const client = await MongoClient.connect(mongoUrl, { useUnifiedTopology: true });
        console.log('Connected to MongoDB');

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Function to scrape IKH site
        const scrapeIKH = async () => {
            const baseUrl = 'https://www.ikh.fi/fi/varaosat/traktori';
            let currentPage = 1;
            let totalPages = 1;
            const products = [];

            do {
                const url = `${baseUrl}?p=${currentPage}&product_list_mode=list`;
                console.log(`Scraping IKH page: ${currentPage}`);

                const response = await axios.get(url);
                const html = response.data;
                const $ = cheerio.load(html);

                if (currentPage === 1) {
                    const totalProductsText = $('.toolbar-amount').text().match(/\/ (\d+)/);
                    const totalProducts = totalProductsText ? parseInt(totalProductsText[1], 10) : 0;
                    totalPages = Math.ceil(totalProducts / 50);
                    console.log(`Total pages for IKH: ${totalPages}`);
                }

                $('.product-item').each((index, element) => {
                    const productName = $(element).find('.product-item-name').text().trim();
                    const productNumber = $(element).find('.product-item-sku').text().trim();
                    const salePrice = $(element).find('.price').text().trim();

                    products.push({
                        name: productName,
                        number: productNumber,
                        price: salePrice,
                        site: 'IKH',
                    });
                });

                currentPage++;
            } while (currentPage <= totalPages);

            console.log(`IKH scraping complete: ${products.length} products found.`);
            return products;
        };

        // Function to scrape Hankkija site
        const scrapeHankkija = async () => {
            const baseUrl = 'https://www.hankkija.fi/varaosat-ja-tarvikkeet/massey-ferguson/tr-varaosat-1815/';
            const products = [];
        
            console.log(`Scraping Hankkija site...`);
            const response = await axios.get(baseUrl);
            const html = response.data;
            const $ = cheerio.load(html);
        
            // Extract product data
            $('a.atuote').each((index, element) => {
                const productName = $(element).data('tnimi') || 'Unknown Product'; // Extract product name from `data-tnimi`
                const productNumber = $(element).data('tkoodi') || 'Unknown Code'; // Extract product number from `data-tkoodi`
                const salePrice = $(element).find('.product-price').text().trim() || 'Price Not Available'; // Extract price text
        
                products.push({
                    name: productName,
                    number: productNumber,
                    price: salePrice,
                    site: 'Hankkija', // Mark the site as Hankkija
                });
            });
        
            console.log(`Hankkija scraping complete: ${products.length} products found.`);
            return products;
        };
        

        // Scrape both sites
        const ikhProducts = await scrapeIKH();
        const hankkijaProducts = await scrapeHankkija();

        // Combine results
        const allProducts = [...ikhProducts, ...hankkijaProducts];
        let insertedCount = 0;

        // Insert products into MongoDB, avoiding duplicates only within the same site
        for (const product of allProducts) {
            const exists = await collection.findOne({
                name: product.name,
                number: product.number,
                site: product.site, // Check for duplicates within the same site
            });

            if (!exists) {
                await collection.insertOne(product);
                insertedCount++;
            }
        }

        console.log(`${insertedCount} new products inserted successfully.`);

        // Close MongoDB connection
        await client.close();
        console.log('MongoDB connection closed.');
    } catch (error) {
        console.error('Error:', error);
    }
})();

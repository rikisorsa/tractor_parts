const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'tractorPartsDB';
const collectionName = 'IKH';

(async () => {
    try {
        // Dynamically import p-limit for concurrency control
        const pLimit = (await import('p-limit')).default; // Dynamic import for ES module
        const limit = pLimit(3); // Limit concurrent requests to 3 to reduce memory load

        // Connect to MongoDB
        const client = await MongoClient.connect(mongoUrl, { useUnifiedTopology: true });
        console.log('Connected to MongoDB');
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Track visited links to avoid revisiting the same sublinks
        const visitedLinks = new Set();

        // Function to scrape IKH site
        const scrapeIKH = async () => {
            const baseUrl = 'https://www.ikh.fi/fi/varaosat/traktori';
            let currentPage = 1;
            let totalPages = 1;

            console.log('Starting IKH scraper...');
            do {
                const url = `${baseUrl}?p=${currentPage}&product_list_mode=list`;
                console.log(`Scraping IKH page: ${currentPage}`);

                try {
                    const response = await axios.get(url);
                    const html = response.data;
                    const $ = cheerio.load(html);

                    // Determine total pages (only on the first page)
                    if (currentPage === 1) {
                        const totalProductsText = $('.toolbar-amount').text().match(/\/ (\d+)/);
                        const totalProducts = totalProductsText ? parseInt(totalProductsText[1], 10) : 0;
                        totalPages = Math.ceil(totalProducts / 50);
                        console.log(`Total pages for IKH: ${totalPages}`);
                    }

                    // Insert each product into MongoDB directly
                    $('.product-item').each(async (index, element) => {
                        const productName = $(element).find('.product-item-name').text().trim();
                        const productNumber = $(element).find('.product-item-sku').text().trim();
                        const salePrice = $(element).find('.price').text().trim();

                        const product = {
                            name: productName,
                            number: productNumber,
                            price: salePrice,
                            site: 'IKH',
                        };

                        await insertProductIntoDB(product, collection);
                    });

                    currentPage++;
                } catch (error) {
                    console.error(`Error scraping IKH page: ${currentPage}`, error);
                    break; // Break if an error occurs to prevent infinite loop
                }
            } while (currentPage <= totalPages);
        };

        // Function to scrape products from a single Hankkija page with pagination
        const scrapeProducts = async (url) => {
            let currentPage = 1;
            let hasMorePages = true;

            while (hasMorePages) {
                const paginatedUrl = `${url}?p=${currentPage}`;
                console.log(`Scraping products from: ${paginatedUrl}`);

                try {
                    const response = await axios.get(paginatedUrl);
                    const $ = cheerio.load(response.data);

                    // Insert each product into MongoDB directly
                    $('a.atuote').each(async (index, element) => {
                        const productName = $(element).data('tnimi') || 'Unknown Product';
                        const productNumber = $(element).data('tkoodi') || 'Unknown Code';
                        const salePrice = $(element).find('.product-price').text().trim() || 'Price Not Available';

                        const product = {
                            name: productName,
                            number: productNumber,
                            price: salePrice,
                            site: 'Hankkija',
                        };

                        await insertProductIntoDB(product, collection);
                    });

                    // Check if there are more pages
                    const nextPageExists = $('a.next, a.pagination__next').length > 0;
                    hasMorePages = nextPageExists;
                    currentPage++;
                } catch (error) {
                    console.error(`Error scraping products from: ${paginatedUrl}`, error);
                    hasMorePages = false; // Stop pagination on error
                }
            }
        };

        // Function to iteratively scrape Hankkija instead of using deep recursion
        const scrapeHankkijaIteratively = async (initialUrl) => {
            const urlsToVisit = [initialUrl];
            while (urlsToVisit.length > 0) {
                const currentUrl = urlsToVisit.pop();

                if (visitedLinks.has(currentUrl)) {
                    console.log(`Skipping already visited: ${currentUrl}`);
                    continue;
                }
                visitedLinks.add(currentUrl);

                console.log(`Scraping sublinks from: ${currentUrl}`);

                try {
                    const response = await axios.get(currentUrl);
                    const $ = cheerio.load(response.data);

                    // Extract sublinks
                    $('a').each((index, element) => {
                        const href = $(element).attr('href');
                        if (href && href.startsWith('/varaosat-ja-tarvikkeet/')) {
                            const absoluteUrl = `https://www.hankkija.fi${href}`;
                            if (!visitedLinks.has(absoluteUrl) && !urlsToVisit.includes(absoluteUrl) && !href.includes('ajankohtaista') && !href.includes('uutuus')) {
                                urlsToVisit.push(absoluteUrl);
                            }
                        }
                    });

                    // Scrape products on the current page
                    await scrapeProducts(currentUrl);
                } catch (error) {
                    console.error(`Error scraping sublinks from: ${currentUrl}`, error);
                }
            }
        };

        // Function to insert a product into MongoDB
        const insertProductIntoDB = async (product, collection) => {
            try {
                const exists = await collection.findOne({
                    name: product.name,
                    number: product.number,
                    site: product.site,
                });

                if (!exists) {
                    await collection.insertOne(product);
                    console.log(`Inserted new product: ${product.name}`);
                }
            } catch (error) {
                console.error(`Error inserting product into DB: ${product.name}`, error);
            }
        };

        // Start scraping
        await scrapeIKH();
        const hankkijaMainUrl = 'https://www.hankkija.fi/varaosat-ja-tarvikkeet/';
        await scrapeHankkijaIteratively(hankkijaMainUrl);

        // Close MongoDB connection
        await client.close();
        console.log('MongoDB connection closed.');
    } catch (error) {
        console.error('Error:', error);
    }
})();

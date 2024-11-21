const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

(async () => {
    // Dynamically import p-limit (ES Module)
    const pLimit = (await import('p-limit')).default;

    const mongoUrl = 'mongodb://localhost:27017';
    const dbName = 'tractorPartsDB';
    const collectionName = 'IKH';
    const concurrencyLimit = 15; // Increase concurrency level for better performance

    try {
        // Limit concurrent requests
        const limit = pLimit(concurrencyLimit);

        // Connect to MongoDB
        const client = await MongoClient.connect(mongoUrl, { useUnifiedTopology: true });
        console.log('Connected to MongoDB');
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Track visited links to avoid revisiting the same sublinks
        const visitedLinks = new Set();

        // Axios instance with timeout and gzip compression enabled
        const axiosInstance = axios.create({
            timeout: 10000, // Timeout set to 10 seconds
            headers: {
                'Accept-Encoding': 'gzip, deflate, br', // Enable gzip or Brotli compression
            },
        });

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
                    const response = await axiosInstance.get(url);
                    const html = response.data;
                    const $ = cheerio.load(html);

                    // Determine total pages (only on the first page)
                    if (currentPage === 1) {
                        const totalProductsText = $('.toolbar-amount').text().match(/\/ (\d+)/);
                        const totalProducts = totalProductsText ? parseInt(totalProductsText[1], 10) : 0;
                        totalPages = Math.ceil(totalProducts / 50);
                        console.log(`Total pages for IKH: ${totalPages}`);
                    }

                    // Collect and insert product data
                    const productsBatch = [];
                    $('.product-item').each((index, element) => {
                        const productName = $(element).find('.product-item-name').text().trim();
                        const productNumber = $(element).find('.product-item-sku').text().trim();
                        const salePrice = $(element).find('.price').text().trim();
                        const productLink = $(element).find('.product-item-name a').attr('href');

                        const product = {
                            name: productName,
                            number: productNumber,
                            price: salePrice,
                            link: productLink ? `https://www.ikh.fi${productLink}` : null,
                            site: 'IKH',
                            scrapedDate: new Date().toISOString(),
                        };

                        productsBatch.push(product);
                    });

                    // Insert products in batches of 50
                    if (productsBatch.length > 0) {
                        await insertProductsBatch(productsBatch, collection);
                    }

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
            const productsBatch = [];

            while (hasMorePages) {
                const paginatedUrl = `${url}?p=${currentPage}`;
                console.log(`Scraping products from: ${paginatedUrl}`);

                try {
                    const response = await axiosInstance.get(paginatedUrl);
                    const $ = cheerio.load(response.data);

                    // Collect product data
                    $('a.atuote').each((index, element) => {
                        const productName = $(element).data('tnimi') || 'Unknown Product';
                        const productNumber = $(element).data('tkoodi') || 'Unknown Code';
                        const salePrice = $(element).find('.product-price').text().trim() || 'Price Not Available';
                        const productLink = $(element).attr('href');

                        const product = {
                            name: productName,
                            number: productNumber,
                            price: salePrice,
                            link: productLink ? `https://www.hankkija.fi${productLink}` : null,
                            site: 'Hankkija',
                            scrapedDate: new Date().toISOString(),
                        };

                        productsBatch.push(product);
                    });

                    // Insert products in batches of 50 to MongoDB
                    if (productsBatch.length >= 50) {
                        await insertProductsBatch(productsBatch, collection);
                        productsBatch.length = 0; // Clear the batch after insertion
                    }

                    // Check if there are more pages
                    const nextPageExists = $('a.next, a.pagination__next').length > 0;
                    hasMorePages = nextPageExists;
                    currentPage++;
                } catch (error) {
                    console.error(`Error scraping products from: ${paginatedUrl}`, error);
                    hasMorePages = false; // Stop pagination on error
                }
            }

            // Insert remaining products
            if (productsBatch.length > 0) {
                await insertProductsBatch(productsBatch, collection);
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
                    const response = await axiosInstance.get(currentUrl);
                    const $ = cheerio.load(response.data);

                    // Extract sublinks and add them to the list to visit
                    $('a').each((index, element) => {
                        const href = $(element).attr('href');
                        if (href && href.startsWith('/varaosat-ja-tarvikkeet/')) {
                            const absoluteUrl = `https://www.hankkija.fi${href}`;
                            if (
                                !visitedLinks.has(absoluteUrl) &&
                                !urlsToVisit.includes(absoluteUrl) &&
                                !href.includes('ajankohtaista') &&
                                !href.includes('uutuus') &&
                                !href.includes('uutiset') &&
                                !href.includes('kampanja')
                            ) {
                                urlsToVisit.push(absoluteUrl);
                            }
                        }
                    });

                    // Scrape products on the current page concurrently
                    await limit(() => scrapeProducts(currentUrl));
                } catch (error) {
                    console.error(`Error scraping sublinks from: ${currentUrl}`, error);
                }
            }
        };

        // Function to insert a batch of products into MongoDB
        const insertProductsBatch = async (products, collection) => {
            try {
                if (products.length > 0) {
                    // Use insertMany to insert products in batches
                    const operations = products.map((product) => ({
                        updateOne: {
                            filter: {
                                name: product.name,
                                number: product.number,
                                site: product.site,
                            },
                            update: {
                                $setOnInsert: product,
                                $set: {
                                    link: product.link,
                                    scrapedDate: product.scrapedDate,
                                },
                            },
                            upsert: true,
                        },
                    }));

                    const result = await collection.bulkWrite(operations);
                    console.log(`${result.upsertedCount} new products inserted.`);
                }
            } catch (error) {
                console.error('Error inserting products batch into DB', error);
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

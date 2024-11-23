const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

let totalProductsInserted = 0; // Counter for total products inserted
let client; // MongoDB client
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
    const mongoUrl = 'mongodb://localhost:27017';
    const dbName = 'tractorPartsDB';
    const productsCollectionName = 'IKH';
    const visitedLinksCollectionName = 'visitedLinks';
    const concurrencyLimit = 5; // Concurrency limit for parallel requests
    const today = new Date().toISOString().split('T')[0]; // Current date in YYYY-MM-DD format

    try {
        const pLimit = (await import('p-limit')).default;
        const limit = pLimit(concurrencyLimit);

        client = await MongoClient.connect(mongoUrl);
        console.log('Connected to MongoDB');

        const db = client.db(dbName);
        const productsCollection = db.collection(productsCollectionName);
        const visitedLinksCollection = db.collection(visitedLinksCollectionName);

        console.log('Connected to MongoDB database:', db.databaseName);
        console.log('Using collection:', productsCollection.collectionName);

        const axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'Accept-Encoding': 'gzip, deflate, br',
            },
        });

        const isLinkVisited = async (url) => {
            const existingLink = await visitedLinksCollection.findOne({ url, date: today });
            return !!existingLink;
        };

        const markLinkAsVisited = async (url) => {
            await visitedLinksCollection.updateOne(
                { url },
                { $set: { url, date: today } },
                { upsert: true }
            );
        };

        const insertProductsBatch = async (products, collection) => {
            try {
                if (products.length > 0) {
                    console.log('Inserting Products Batch:', products); // Debug log

                    const operations = products.map((product) => ({
                        updateOne: {
                            filter: {
                                name: product.name,
                                number: product.number,
                                site: product.site,
                            },
                            update: {
                                $setOnInsert: {
                                    name: product.name,
                                    number: product.number,
                                    link: product.link,
                                    site: product.site,
                                    scrapedDate: product.scrapedDate,
                                },
                                $set: {
                                    price: product.price,
                                    oemNumbers: product.oemNumbers || null,
                                    compatibleTractors: product.compatibleTractors || [],
                                },
                            },
                            upsert: true,
                        },
                    }));

                    const result = await collection.bulkWrite(operations);

                    console.log(`${result.upsertedCount} new products inserted.`);
                    totalProductsInserted += result.upsertedCount;
                } else {
                    console.warn('No products to insert for this batch.');
                }
            } catch (error) {
                console.error('Error inserting products batch into DB:', error);
            }
        };

        const updateExistingDocuments = async (products, collection) => {
            try {
                for (const product of products) {
                    const filter = { number: product.number, site: product.site };
                    const update = {
                        $set: {
                            oemNumber: product.oemNumber, // Add or update OEM number
                        },
                    };

                    await collection.updateOne(filter, update, { upsert: false }); // Only update existing documents
                }

                console.log(`Successfully updated OEM numbers for ${products.length} documents.`);
            } catch (error) {
                console.error('Error updating documents:', error);
            }
        };

        const scrapeProducts = async (url) => {
            console.log(`Scraping products from: ${url}`);
            const productsBatch = [];

            try {
                const response = await axiosInstance.get(url);
                const html = response.data;
                const $ = cheerio.load(html);

                $('script').each((_, scriptElement) => {
                    const scriptContent = $(scriptElement).html();
                    if (scriptContent.includes('window.dataLayer')) {
                        const dataLayerMatch = scriptContent.match(/window\.dataLayer\s*=\s*(\[.*?\]);/s);
                        if (dataLayerMatch) {
                            const dataLayer = JSON.parse(dataLayerMatch[1]);
                            dataLayer.forEach((entry) => {
                                if (entry.ecommerce && entry.ecommerce.items) {
                                    entry.ecommerce.items.forEach((item) => {
                                        const product = {
                                            name: item.item_name,
                                            number: item.item_id, // OEM number
                                            price: parseFloat(item.price.replace(',', '.')),
                                            brand: item.item_brand,
                                            category: item.item_category,
                                            subCategory: item.item_category_2,
                                            oemNumber: item.item_id, // OEM Number
                                            link: null,
                                            site: 'Hankkija',
                                            scrapedDate: new Date().toISOString(),
                                        };
                                        productsBatch.push(product);
                                    });
                                }
                            });
                        }
                    }
                });

                if (productsBatch.length > 0) {
                    await updateExistingDocuments(productsBatch, productsCollection);
                    await insertProductsBatch(productsBatch, productsCollection);
                } else {
                    console.log(`No products found on page: ${url}`);
                }
            } catch (error) {
                console.error(`Error scraping products from: ${url}`, error);
            }
        };

        const scrapeIKHProductDetails = async (productUrl) => {
            try {
                console.log(`Scraping product details from: ${productUrl}`);

                // Fetch the product detail page
                const response = await axiosInstance.get(productUrl);
                const $ = cheerio.load(response.data);

                // Extract OEM numbers
                const oemNumbers = [];
                $('ul.oem-numbers li').each((_, element) => {
                    const oemNumber = $(element).text().trim();
                    if (oemNumber) oemNumbers.push(oemNumber);
                });
                console.log(`OEM Numbers for ${productUrl}:`, oemNumbers); // Debug log for OEM numbers

                // Extract compatible tractors
                const compatibleTractors = [];
                $('div.compatible-items__models a.compatible-items__model').each((_, element) => {
                    const tractorModel = $(element).attr('title');
                    if (tractorModel) compatibleTractors.push(tractorModel);
                });
                console.log(`Compatible Tractors for ${productUrl}:`, compatibleTractors); // Debug log for tractors

                // Return extracted details
                return {
                    oemNumbers: oemNumbers.length > 0 ? oemNumbers : null, // Return null if empty
                    compatibleTractors: compatibleTractors.length > 0 ? compatibleTractors : [], // Return empty array if no tractors
                };
            } catch (error) {
                console.error(`Error scraping product details from: ${productUrl}`, error);
                return { oemNumbers: null, compatibleTractors: [] }; // Gracefully handle errors
            }
        };

        const scrapeIKH = async () => {
            const baseUrl = 'https://www.ikh.fi/fi/varaosat/traktori';
            let currentPage = 1;
            let totalPages = 1;

            console.log('Starting IKH scraper...');
            do {
                const url = `${baseUrl}?p=${currentPage}&product_list_mode=list`;
                if (await isLinkVisited(url)) {
                    console.log(`Skipping already visited link today: ${url}`);
                    currentPage++;
                    continue;
                }

                console.log(`Scraping IKH page: ${currentPage}`);

                const productsBatch = []; // Declare productsBatch here

                try {
                    const response = await axiosInstance.get(url);
                    const html = response.data;
                    const $ = cheerio.load(html);

                    if (currentPage === 1) {
                        const totalProductsText = $('.toolbar-amount').text().match(/\/ (\d+)/);
                        const totalProducts = totalProductsText ? parseInt(totalProductsText[1], 10) : 0;
                        totalPages = Math.ceil(totalProducts / 50);
                        console.log(`Total pages for IKH: ${totalPages}`);
                    }

                    const productElements = $('.product-item').toArray();
                    for (const element of productElements) {
                        const productName = $(element).find('.product-item-name').text().trim();
                        const productLink = $(element).find('.product-item-name a').attr('href');
                        const productNumber = $(element).find('.product-item-sku').text().trim();
                        const productPrice = $(element).find('.price').text().trim();

                        if (!productLink) {
                            console.error('Product link not found, skipping...');
                            continue;
                        }

                        let fullProductLink;
                        if (productLink.startsWith('http')) {
                            fullProductLink = productLink;
                        } else if (productLink.startsWith('/')) {
                            fullProductLink = `https://www.ikh.fi${productLink}`;
                        } else {
                            console.error(`Malformed product link: ${productLink}`);
                            continue;
                        }

                        console.log(`Scraping product details from: ${fullProductLink}`);
                        await sleep(2000); // Add delay here

                        const { oemNumbers, compatibleTractors } = await scrapeIKHProductDetails(fullProductLink);

                        console.log({
                            name: productName,
                            number: productNumber,
                            price: productPrice,
                            oemNumbers,
                            compatibleTractors,
                            link: fullProductLink,
                        });

                        const product = {
                            name: productName,
                            number: productNumber,
                            price: productPrice || null,
                            oemNumbers: oemNumbers,
                            compatibleTractors: compatibleTractors,
                            link: fullProductLink,
                            site: 'IKH',
                            scrapedDate: new Date().toISOString(),
                        };

                        productsBatch.push(product);
                    }

                    if (productsBatch.length > 0) {
                        console.log(`Products Batch for Page ${currentPage}:`, productsBatch);
                        await insertProductsBatch(productsBatch, productsCollection);
                    }

                    await markLinkAsVisited(url);
                    currentPage++;
                } catch (error) {
                    console.error(`Error scraping IKH page: ${currentPage}`, error);
                    break;
                }
            } while (currentPage <= totalPages);
        };


        const scrapeHankkijaIteratively = async (initialUrl) => {
            const urlsToVisit = [{ url: initialUrl, depth: 0 }];
            const maxDepth = 3;
            const visitedSet = new Set();

            while (urlsToVisit.length > 0) {
                const current = urlsToVisit.pop();
                const currentUrl = current.url;
                const currentDepth = current.depth;

                if (await isLinkVisited(currentUrl)) {
                    console.log(`Skipping already visited link today: ${currentUrl}`);
                    continue;
                }

                if (currentDepth > maxDepth) {
                    console.log(`Skipping link beyond max depth: ${currentUrl}`);
                    continue;
                }

                console.log(`Scraping sublinks from: ${currentUrl}`);

                try {
                    const response = await axiosInstance.get(currentUrl);
                    const $ = cheerio.load(response.data);

                    $('a').each((_, element) => {
                        const href = $(element).attr('href');
                        const fullUrl = href ? `https://www.hankkija.fi${href}` : null;

                        if (
                            fullUrl &&
                            fullUrl.startsWith('https://www.hankkija.fi/varaosat-ja-tarvikkeet/') &&
                            !visitedSet.has(fullUrl)
                        ) {
                            visitedSet.add(fullUrl);
                            urlsToVisit.push({ url: fullUrl, depth: currentDepth + 1 });
                        }
                    });

                    await scrapeProducts(currentUrl);
                    await sleep(2000); // Add delay here
                    await markLinkAsVisited(currentUrl);
                } catch (error) {
                    console.error(`Error scraping sublinks from: ${currentUrl}`, error);
                }
            }
        };


        await scrapeIKH();
        const hankkijaMainUrl = 'https://www.hankkija.fi/varaosat-ja-tarvikkeet/';
        await scrapeHankkijaIteratively(hankkijaMainUrl);

        console.log(`Total products inserted: ${totalProductsInserted}`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (client) {
            await client.close();
            console.log('MongoDB connection closed.');
        }
    }
})();

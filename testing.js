const axios = require('axios');
const cheerio = require('cheerio');
const { MongoClient } = require('mongodb');

let totalProductsInserted = 0; // Counter for total products inserted
let client; // MongoDB client

(async () => {
    const mongoUrl = 'mongodb://localhost:27017';
    const dbName = 'tractorPartsDB';
    const productsCollectionName = 'IKH';
    const visitedLinksCollectionName = 'visitedLinks';
    const concurrencyLimit = 50; // Concurrency limit for parallel requests
    const today = new Date().toISOString().split('T')[0]; // Current date in YYYY-MM-DD format

    try {
        const pLimit = (await import('p-limit')).default;
        const limit = pLimit(concurrencyLimit);

        client = await MongoClient.connect(mongoUrl);
        console.log('Connected to MongoDB');
        const db = client.db(dbName);
        const productsCollection = db.collection(productsCollectionName);
        const visitedLinksCollection = db.collection(visitedLinksCollectionName);

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
                                    oemNumber: product.oemNumber || null,
                                    compatibleTractors: product.compatibleTractors || [],
                                },
                            },
                            upsert: true,
                        },
                    }));

                    const result = await collection.bulkWrite(operations);
                    console.log(`${result.upsertedCount} new products inserted.`);
                    totalProductsInserted += result.upsertedCount;
                }
            } catch (error) {
                console.error('Error inserting products batch into DB:', error);
            }
        };

        const scrapeIKHProductDetails = async (productUrl) => {
            try {
                const response = await axiosInstance.get(productUrl);
                const $ = cheerio.load(response.data);

                // Extract OEM numbers
                const oemNumbers = [];
                $('ul.oem-numbers li').each((_, element) => {
                    oemNumbers.push($(element).text().trim());
                });

                // Extract compatible tractors
                const compatibleTractors = [];
                $('div.compatible-items__models a.compatible-items__model').each((_, element) => {
                    compatibleTractors.push($(element).attr('title'));
                });

                return {
                    oemNumbers: oemNumbers.length > 0 ? oemNumbers : null,
                    compatibleTractors: compatibleTractors.length > 0 ? compatibleTractors : [],
                };
            } catch (error) {
                console.error(`Error scraping product details from: ${productUrl}`, error);
                return { oemNumbers: null, compatibleTractors: [] };
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

                    const productsBatch = [];
                    $('.product-item').each(async (_, element) => {
                        const productName = $(element).find('.product-item-name').text().trim();
                        const productLink = $(element).find('.product-item-name a').attr('href');
                        const productNumber = $(element).find('.product-item-sku').text().trim();
                        const productPrice = $(element).find('.price').text().trim();

                        if (!productLink) return;

                        const fullProductLink = `https://www.ikh.fi${productLink}`;
                        const { oemNumbers, compatibleTractors } = await scrapeIKHProductDetails(fullProductLink);

                        const product = {
                            name: productName,
                            number: productNumber,
                            price: productPrice || null,
                            oemNumber: oemNumbers,
                            compatibleTractors: compatibleTractors,
                            link: fullProductLink,
                            site: 'IKH',
                            scrapedDate: new Date().toISOString(),
                        };

                        productsBatch.push(product);
                    });

                    if (productsBatch.length > 0) {
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

        await scrapeIKH();
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

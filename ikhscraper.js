const axios = require('axios');
const cheerio = require('cheerio');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isLinkVisited = async (url, visitedLinksCollection, today) => {
    const existingLink = await visitedLinksCollection.findOne({ url, date: today });
    return !!existingLink;
};

const markLinkAsVisited = async (url, visitedLinksCollection, today) => {
    await visitedLinksCollection.updateOne(
        { url },
        { $set: { url, date: today } },
        { upsert: true }
    );
};

const scrapeIKHProductDetails = async (productUrl) => {
    try {
        const response = await axios.get(productUrl);
        const $ = cheerio.load(response.data);

        const oemNumbers = [];
        $('ul.oem-numbers li').each((_, element) => {
            const oemNumber = $(element).text().trim();
            if (oemNumber) oemNumbers.push(oemNumber);
        });

        const compatibleTractors = [];
        $('div.compatible-items__models a.compatible-items__model').each((_, element) => {
            const tractorModel = $(element).attr('title');
            if (tractorModel) compatibleTractors.push(tractorModel);
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
    let totalPages = 1; // To be dynamically calculated
    const productsPerPage = 50; // Adjust based on website pagination
    const today = new Date().toISOString().split('T')[0];

    const { collection: productsCollection, db } = await connectToDatabase();
    const visitedLinksCollection = db.collection('visitedLinks');

    console.log('Starting IKH scraper...');

    let totalProducts = 0; // Variable to store the total number of products
    let processedProducts = 0; // Counter for processed products

    do {
        const url = `${baseUrl}?p=${currentPage}&product_list_mode=list`;

        if (await isLinkVisited(url, visitedLinksCollection, today)) {
            console.log(`Skipping already visited link: ${url}`);
            currentPage++;
            continue;
        }

        console.log(`Scraping IKH page: ${currentPage}`);
        const productsBatch = [];

        try {
            const response = await axios.get(url);
            const $ = cheerio.load(response.data);

            // Extract total number of items on the first page
            if (currentPage === 1) {
                const totalProductsText = $('#toolbar-amount').text().match(/\/ (\d+)/);
                totalProducts = totalProductsText ? parseInt(totalProductsText[1], 10) : 0;
                totalPages = Math.ceil(totalProducts / productsPerPage);
                console.log(`Total products: ${totalProducts}, Total pages: ${totalPages}`);
            }

            const productElements = $('.product-item').toArray();
            for (const element of productElements) {
                const productName = $(element).find('.product-item-name').text().trim();
                const productLink = $(element).find('.product-item-name a').attr('href');
                const productNumber = $(element).find('.product-item-sku').text().trim();
                const productPrice = $(element).find('.price').text().trim();

                const fullProductLink = productLink.startsWith('/')
                    ? `https://www.ikh.fi${productLink}`
                    : productLink;

                console.log(`Scraping product details from: ${fullProductLink}`);
                await sleep(2000);

                const { oemNumbers, compatibleTractors } = await scrapeIKHProductDetails(fullProductLink);

                const product = {
                    name: productName,
                    number: productNumber,
                    price: productPrice || null,
                    oemNumbers,
                    compatibleTractors,
                    link: fullProductLink,
                    site: 'IKH',
                    scrapedDate: new Date().toISOString(),
                };

                productsBatch.push(product);
                processedProducts++; // Increment the processed product counter

                // Log progress
                console.log(`Processed ${processedProducts}/${totalProducts}`);
            }

            await insertProductsBatch(productsBatch, productsCollection);
            await markLinkAsVisited(url, visitedLinksCollection, today);
            currentPage++;
        } catch (error) {
            console.error(`Error scraping IKH page: ${currentPage}`, error);
            break;
        }
    } while (currentPage <= totalPages);

    await closeDatabase();
};

scrapeIKH();

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Function to save image locally
const saveImageToLocal = async (url, filename) => {
    if (!url) return;

    const dir = path.join(__dirname, 'images/oem');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, filename);

    // Check if file already exists
    if (fs.existsSync(filePath)) {
        console.log(`Image already exists, skipping: ${filePath}`);
        return;
    }

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
    });

    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log(`Image saved locally as: ${filePath}`);
            resolve(filePath);
        });
        writer.on('error', reject);
    });
};

// Function to check if a link has been visited
const isLinkVisited = async (url, visitedLinksCollection, today) => {
    const existingLink = await visitedLinksCollection.findOne({ url, date: today });
    return !!existingLink;
};

// Function to mark a link as visited
const markLinkAsVisited = async (url, visitedLinksCollection, today) => {
    await visitedLinksCollection.updateOne(
        { url },
        { $set: { url, date: today } },
        { upsert: true }
    );
};

// Function to scrape product details, including image URL and category
const scrapeIKHProductDetails = async (productUrl) => {
    try {
        const response = await axios.get(productUrl);
        const $ = cheerio.load(response.data);

        const oemNumbers = [];
        $('ul.oem-numbers li').each((_, element) => {
            const oemNumber = $(element).text().trim();
            if (oemNumber) oemNumbers.push(oemNumber);
        });

        let imageUrl = $('img.product-image-photo').attr('src');
        if (imageUrl && imageUrl.startsWith('/')) {
            imageUrl = `https://www.ikh.fi${imageUrl}`;
        }

        const category = $('td[data-th="Varaosatyyppi"]').text().trim() || null;

        return {
            oemNumbers: oemNumbers.length > 0 ? oemNumbers : null,
            imageUrl: imageUrl || null,
            category: category,
        };
    } catch (error) {
        console.error(`Error scraping product details from: ${productUrl}`, error);
        return { oemNumbers: null, imageUrl: null, category: null };
    }
};

// Main scraping function
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

        // Check if the link is already visited
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
                const fullProductLink = productLink.startsWith('/')
                    ? `https://www.ikh.fi${productLink}`
                    : productLink;

                console.log(`Scraping product details from: ${fullProductLink}`);
                await sleep(50);

                const { oemNumbers, imageUrl, category } = await scrapeIKHProductDetails(fullProductLink);

                // Determine image filename based on OEM number or product name
                let imageFilename = oemNumbers && oemNumbers.length > 0
                    ? `${oemNumbers[0]}.jpg`
                    : `${productName.replace(/\s+/g, '_')}.jpg`;

                // Save image locally if available and not already saved
                if (imageUrl) {
                    await saveImageToLocal(imageUrl, imageFilename);
                }

                const product = {
                    name: productName,
                    oemNumbers,
                    category,
                    link: fullProductLink,
                    site: 'IKH',
                    scrapedDate: new Date().toLocaleString('en-GB', {
                        timeZone: 'Europe/Helsinki',
                        hour12: false,
                    }),
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

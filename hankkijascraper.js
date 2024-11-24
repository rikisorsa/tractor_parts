const axios = require('axios');
const cheerio = require('cheerio');
const { connectToDatabase, closeDatabase, insertProductsBatch } = require('./dbutils');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scrapeHankkija = async (initialUrl) => {
    const { collection } = await connectToDatabase();
    const urlsToVisit = [initialUrl];

    while (urlsToVisit.length > 0) {
        const currentUrl = urlsToVisit.pop();

        console.log(`Scraping Hankkija sublinks from: ${currentUrl}`);
        await sleep(2000);

        try {
            const response = await axios.get(currentUrl);
            const $ = cheerio.load(response.data);

            const productsBatch = [];

            // Extract products logic here...

            await insertProductsBatch(productsBatch, collection);
        } catch (error) {
            console.error(`Error scraping Hankkija sublinks from: ${currentUrl}`, error);
        }
    }

    await closeDatabase();
};

scrapeHankkija('https://www.hankkija.fi/varaosat-ja-tarvikkeet/');

const { MongoClient } = require('mongodb');

require('dotenv').config();
const mongoUrl = `mongodb://admin:${process.env.MONGO_PASSWORD}@mongodb:27017`;
const dbName = 'tractorPartsDB';
const collectionName = 'main';

let client;

const connectToDatabase = async () => {
    try {
        if (!client) {
            client = new MongoClient(mongoUrl); // No need for useUnifiedTopology
            await client.connect();
            console.log(`[${new Date().toISOString()}] Connected to MongoDB`);
        }
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        console.log(`[${new Date().toISOString()}] Using collection: ${collectionName}`);
        return { db, collection };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error connecting to MongoDB:`, error);
        process.exit(1); // Ensure the app exits if DB connection fails
    }
};

const closeDatabase = async () => {
    if (client) {
        try {
            await client.close();
            console.log(`[${new Date().toISOString()}] MongoDB connection closed.`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error closing MongoDB connection:`, error);
        }
    }
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
                            oemNumbers: product.oemNumbers || null,
                            compatibleTractors: product.compatibleTractors || [],
                            category: product.category || null, // Add category here
                        },
                    },
                    upsert: true,
                },
            }));
            const result = await collection.bulkWrite(operations);
            console.log(`[${new Date().toISOString()}] ${result.upsertedCount} new products inserted.`);
        } else {
            console.log(`[${new Date().toISOString()}] No products to insert.`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error inserting products batch into DB:`, error);
    }
};

module.exports = { connectToDatabase, closeDatabase, insertProductsBatch };

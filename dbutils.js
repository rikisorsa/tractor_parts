const { MongoClient } = require('mongodb');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// MongoDB URL without authentication for local development
const mongoUrl = isProduction
    ? `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_HOST_PROD}:${process.env.MONGO_PORT_PROD}`
    : `mongodb://${process.env.MONGO_HOST_DEV}:${process.env.MONGO_PORT_DEV}`; // No credentials for local dev

const dbName = process.env.MONGO_DB_NAME || 'tractorPartsDB';
const collectionName = process.env.MONGO_COLLECTION_NAME || 'main';

let client;

const connectToDatabase = async () => {
    try {
        if (!client) {
            client = new MongoClient(mongoUrl);
            await client.connect();
            console.log(`[${new Date().toISOString()}] Connected to MongoDB (${isProduction ? 'Production' : 'Development'})`);
        }
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        return { db, collection };
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error connecting to MongoDB:`, error);
        process.exit(1);
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
                            category: product.category || null,
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

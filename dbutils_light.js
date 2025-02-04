const { MongoClient } = require('mongodb');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const mongoUrl = isProduction
    ? `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_HOST_PROD}:${process.env.MONGO_PORT_PROD}`
    : `mongodb://${process.env.MONGO_HOST_DEV}:${process.env.MONGO_PORT_DEV}`;

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

const updateLightProducts = async (products, collection) => {
    try {
        if (products.length > 0) {
            for (const product of products) {
                const existingProduct = await collection.findOne({ name: product.name, site: 'IKH' });

                if (existingProduct) {
                    let updates = {};
                    if (existingProduct.price !== product.price) {
                        updates.price = product.price;
                    }
                    if (existingProduct.availability !== product.availability) {
                        updates.availability = product.availability;
                    }

                    if (Object.keys(updates).length > 0) {
                        await collection.updateOne(
                            { name: product.name, site: 'IKH' },
                            { $set: updates }
                        );
                        console.log(`Updated: ${product.name} | ${JSON.stringify(updates)}`);
                    }
                }
            }
        } else {
            console.log(`[${new Date().toISOString()}] No products to update.`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error updating products in DB:`, error);
    }
};

module.exports = { connectToDatabase, closeDatabase, updateLightProducts};

const { MongoClient } = require('mongodb');

const mongoUrl = 'mongodb://localhost:27017';
const dbName = 'tractorPartsDB';
const collectionName = 'IKH';

let client;

const connectToDatabase = async () => {
    try {
        if (!client) {
            client = await MongoClient.connect(mongoUrl);
            console.log('Connected to MongoDB');
        }
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        return { db, collection };
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
};

const closeDatabase = async () => {
    if (client) {
        await client.close();
        console.log('MongoDB connection closed.');
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
                        },
                    },
                    upsert: true,
                },
            }));
            const result = await collection.bulkWrite(operations);
            console.log(`${result.upsertedCount} new products inserted.`);
        } else {
            console.log('No products to insert.');
        }
    } catch (error) {
        console.error('Error inserting products batch into DB:', error);
    }
};

module.exports = { connectToDatabase, closeDatabase, insertProductsBatch };

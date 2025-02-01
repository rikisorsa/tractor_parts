require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const productRoutes = require('./routes/productRoutes');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';
const mongoHost = isProduction ? process.env.MONGO_HOST_PROD : process.env.MONGO_HOST_DEV;
const mongoPort = isProduction ? process.env.MONGO_PORT_PROD : process.env.MONGO_PORT_DEV;
const mongoDb = process.env.MONGO_DB || 'tractorPartsDB';

// Construct MongoDB connection string
const MONGO_URI = isProduction
    ? `mongodb://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@${mongoHost}:${mongoPort}/${mongoDb}?authSource=admin`
    : `mongodb://${mongoHost}:${mongoPort}/${mongoDb}`; // No authentication for local MongoDB

mongoose
  .connect(MONGO_URI)
  .then(() => console.log(`Connected to MongoDB (${isProduction ? 'Production' : 'Development'})`))
  .catch((err) => console.error('Error connecting to MongoDB:', err));

// CORS Configuration
const corsOptions = {
  origin: isProduction ? 'https://farmeri.fi' : '*', // Allow all in development
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type,Authorization'
};

app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use('/api/products', productRoutes);

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://94.237.32.45:${PORT}`));

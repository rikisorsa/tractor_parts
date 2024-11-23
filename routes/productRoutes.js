const express = require('express');
const Product = require('../models/product');

const router = express.Router();

// GET: Search products
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query; // Extract the search query from URL parameters
    const results = await Product.find({ name: new RegExp(query, 'i') }).limit(50); // Search by name
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Error retrieving data', details: err.message });
  }
});

// GET: Retrieve all products (optional)
router.get('/', async (req, res) => {
  try {
    const products = await Product.find().limit(100); // Fetch the first 100 products
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Error retrieving products', details: err.message });
  }
});

module.exports = router;

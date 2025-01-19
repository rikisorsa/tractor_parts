const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  number: { type: String, required: true },
  price: String,
  link: String,
  site: String,
  scrapedDate: { type: Date },
});

// Bind schema to the "IKH" collection
module.exports = mongoose.model('Product', productSchema, 'main');


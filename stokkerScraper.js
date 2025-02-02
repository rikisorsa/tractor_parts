const axios = require("axios");
const { connectToDatabase, closeDatabase, insertProductsBatch } = require("./dbutils");

const baseURL = "https://api.stokker.com/products/get";
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  Referer: "https://www.stokker.fi/",
  "X-DeliveryCountry": "FI",
  "X-Language": "fi",
  DNT: "1",
};

const scrapeStokker = async () => {
  console.log("🚜 Starting Stokker scraper...");

  let currentPage = 1;
  let hasMorePages = true;
  const { collection: productsCollection, db } = await connectToDatabase();

  while (hasMorePages) {
    console.log(`📄 Scraping page: ${currentPage}`);

    try {
      const response = await axios.get(baseURL, {
        headers: headers,
        params: {
          withFilters: 1,
          category: "SP", // Main category (Varaosat)
          page: currentPage,
        },
      });

      if (response.data.status !== "success" || !response.data.products) {
        console.log("❌ No products found or API error.");
        break;
      }

      // **Extract Product Data**
      const productsBatch = response.data.products.map((product) => ({
        name: product.Name,
        oemNumbers: product.MPN || "N/A",
        price: product.CustomerPriceWithVat ? `${product.CustomerPriceWithVat} €` : "N/A",
        availability: product.AvailPhysical > 0 ? "In Stock" : "Out of Stock",
        vendorStock: product.AvailInVendorWarehouse || "N/A",
        link: product.LinkToProducts || "N/A",
        image: product.ImageM || "N/A",
        category: product.CategoryPath || "Unknown",
        site: "Stokker",
        country: ['FIN', 'EST'],
        scrapedDate: new Date().toLocaleString("en-GB", { timeZone: "Europe/Helsinki", hour12: false }),
      }));

      console.log(`✅ Found ${productsBatch.length} products on page ${currentPage}`);

      // **Insert into MongoDB**
      if (productsBatch.length > 0) {
        await insertProductsBatch(productsBatch, productsCollection);
      }

      // **Check for more pages**
      hasMorePages = response.data.products.length > 0;
      currentPage++;

    } catch (error) {
      console.error("❌ Error fetching data:", error.message);
      break;
    }
  }

  await closeDatabase();
  console.log("✅ Scraping complete! Data stored in MongoDB.");
};

// Run scraper
scrapeStokker();

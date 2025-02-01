const axios = require('axios');
const { parseStringPromise } = require('xml2js');

const sitemapUrl = 'https://www.lakkapaa.com/backend/api/v1/feeds/sitemap?sitemap=sitemap_0_products';
/* const sitemapUrl = 'https://www.ikh.fi/fi/media/sitemap_fi_finland-1-1.xml'; */
async function parseSitemap() {
    try {
        // Fetch the sitemap XML
        const response = await axios.get(sitemapUrl);
        const xmlData = response.data;

        // Parse the XML to JSON
        const result = await parseStringPromise(xmlData);

        // Extract URLs from the sitemap
        const urls = result.urlset.url.map(entry => entry.loc[0]);

        // Filter URLs under "varaosat-ja-tarvikkeet"
        /* const varaosatUrls = urls.filter(url => url.includes('/varaosat-ja-tarvikkeet/')); */
        const varaosatUrls = urls.filter(url => url.includes('/maatalous-ja-konekauppa/'));
        console.log(`Total URLs under "varaosat-ja-tarvikkeet": ${varaosatUrls.length}`);
        console.log('Example URLs:', varaosatUrls.slice(0, 10)); // Display the first 10 URLs
    } catch (error) {
        console.error('Error fetching or parsing the sitemap:', error);
    }
}

parseSitemap();

const cheerio = require("cheerio");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createCrawler = ({
  log = console.log,
  sleepMsBetweenBatches = 1000,
  batchSize = 5,
}) => {
  const crawlRecursively = async ({
    initialUrl,
    browser,
    shouldScrapePage,
    handlePage,
    extractLinks,
    maxDepth = 5,
    visited = new Set(),
  }) => {
    const urlsToVisit = [{ url: initialUrl, depth: 0 }];
    let pagesScraped = 0;

    const scrapePage = async ({ url, depth }) => {
      if (visited.has(url) || depth > maxDepth) return;
      visited.add(url);
      pagesScraped++;
      log(`Scraping: ${url} (depth: ${depth})`);

      let page;
      try {
        page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        const html = await page.content();
        const $ = cheerio.load(html);

        if (await shouldScrapePage($, url)) {
          await handlePage($, url, browser);
        }

        const newUrls = extractLinks($, url);
        newUrls.forEach((newUrl) => {
          if (!visited.has(newUrl)) {
            urlsToVisit.push({ url: newUrl, depth: depth + 1 });
          }
        });
      } catch (error) {
        log(`Error scraping ${url}: ${error.message}`);
      } finally {
        if (page) await page.close();
      }
    };

    while (urlsToVisit.length > 0) {
      const batch = urlsToVisit.splice(0, batchSize);
      await Promise.allSettled(batch.map(scrapePage));
      await sleep(sleepMsBetweenBatches);
    }

    log(`Finished crawling. Total pages scraped: ${pagesScraped}`);
  };

  return { crawlRecursively };
};

module.exports = createCrawler;

const createCrawler = require("./crawler");

describe("crawlRecursively", () => {
  let visitedPages;
  let mockBrowser;
  let mockPage;

  beforeEach(() => {
    visitedPages = [];

    mockPage = {
      goto: jest.fn(),
      content: jest.fn().mockResolvedValue("<html></html>"),
      close: jest.fn(),
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
    };
  });

  test("visits initial page and respects maxDepth", async () => {
    const { crawlRecursively } = createCrawler({
      log: jest.fn(),
      sleepMsBetweenBatches: 0, // no wait for tests
      batchSize: 2,
    });

    const shouldScrapePage = jest.fn().mockResolvedValue(true);
    const handlePage = jest.fn(async (_$, url) => {
      visitedPages.push(url);
    });

    const extractLinks = jest.fn().mockImplementation((_$, url) => {
      if (url === "start") return ["page1", "page2"];
      if (url === "page1") return ["page3"];
      return [];
    });

    await crawlRecursively({
      initialUrl: "start",
      browser: mockBrowser,
      shouldScrapePage,
      handlePage,
      extractLinks,
      maxDepth: 1, // will only visit start, page1, page2
    });

    expect(visitedPages).toEqual(
      expect.arrayContaining(["start", "page1", "page2"]),
    );
    expect(visitedPages).not.toContain("page3");
    expect(handlePage).toHaveBeenCalledTimes(3);
  });

  test("avoids revisiting pages", async () => {
    const { crawlRecursively } = createCrawler({
      log: jest.fn(),
      sleepMsBetweenBatches: 0,
      batchSize: 1,
    });

    const shouldScrapePage = jest.fn().mockResolvedValue(true);
    const handlePage = jest.fn(async (_$, url) => {
      visitedPages.push(url);
    });

    const extractLinks = jest.fn().mockImplementation((_$, _url) => {
      return ["start"]; // loops back to itself
    });

    await crawlRecursively({
      initialUrl: "start",
      browser: mockBrowser,
      shouldScrapePage,
      handlePage,
      extractLinks,
      maxDepth: 3,
    });

    expect(visitedPages).toEqual(["start"]);
    expect(handlePage).toHaveBeenCalledTimes(1);
  });
});

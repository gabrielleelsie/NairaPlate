import { describe, expect, it } from "vitest";
import { agoLabel, decodeEntities, matchHeadline, parseFeed } from "./news";

describe("matchHeadline", () => {
  it("picks up a watched topic with a price word", () => {
    expect(matchHeadline("Petrol price hike: workers set October strike")).toEqual({ topics: ["fuel"], rising: true });
    expect(matchHeadline("Tomato prices rise as scarcity bites in Lagos markets")).toEqual({ topics: ["tomatoes"], rising: true });
    expect(matchHeadline("Rice, onions, pepper now dearer in Mile 12")?.topics).toEqual(["rice", "pepper", "onions"]);
    expect(matchHeadline("Transport fares double after diesel increase")?.topics).toEqual(["fuel", "transport"]);
  });
  it("says rising only when the headline itself says so", () => {
    expect(matchHeadline("Petrol prices: what Nigerians pay today")).toEqual({ topics: ["fuel"], rising: false });
    expect(matchHeadline("Rice price falls slightly")).toEqual({ topics: ["rice"], rising: false });
  });
  it("ignores a topic with no price context, and a price with no topic", () => {
    expect(matchHeadline("Fuel station fire kills two")).toBeNull();
    expect(matchHeadline("Rice University signs new partnership")).toBeNull();
    expect(matchHeadline("Cement price hike hits builders")).toBeNull();
    expect(matchHeadline("")).toBeNull();
  });
  it("does not mistake price for rice, or fares for farewell", () => {
    expect(matchHeadline("Price of cement rises")).toBeNull();
    expect(matchHeadline("Farewell party raises funds")).toBeNull();
  });
  it("can use the description for the price context, but the topic must be in the headline", () => {
    expect(matchHeadline("Onions in Kano markets", "Traders say the price has risen sharply")?.topics).toEqual(["onions"]);
    expect(matchHeadline("Markets in Kano", "Onion prices rise")).toBeNull();
  });
});

describe("parseFeed", () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Petrol price hike: N1,350 per litre &amp; rising]]></title><link>https://example.ng/a?x=1&amp;y=2</link><pubDate>Tue, 29 Sep 2026 10:00:00 +0100</pubDate><description><![CDATA[<p>Marketers say...</p>]]></description></item>
    <item><title>No link here</title></item>
    <item><title>Bad link</title><link>javascript:alert(1)</link></item>
    <item><title>Tomato &#8217;s price</title><link>https://example.ng/b</link><pubDate>not a date</pubDate></item>
  </channel></rss>`;
  it("reads items, decodes entities and keeps only safe links", () => {
    const items = parseFeed(rss);
    expect(items.map((i) => i.url)).toEqual(["https://example.ng/a?x=1&y=2", "https://example.ng/b"]);
    expect(items[0]!.title).toBe("Petrol price hike: N1,350 per litre & rising");
    expect(items[0]!.published_at?.toISOString()).toBe("2026-09-29T09:00:00.000Z");
    expect(items[0]!.description).toBe("Marketers say...");
    expect(items[1]!.published_at).toBeNull();
    expect(items[1]!.title).toBe("Tomato ’s price");
  });
  it("reads Atom entries", () => {
    const atom = `<feed><entry><title>Diesel price up</title><link href="https://example.ng/c"/><updated>2026-09-30T08:00:00Z</updated><summary>Up again</summary></entry></feed>`;
    expect(parseFeed(atom)).toEqual([{ title: "Diesel price up", url: "https://example.ng/c", published_at: new Date("2026-09-30T08:00:00Z"), description: "Up again" }]);
  });
  it("copes with junk and caps the number of items", () => {
    expect(parseFeed("<html>not a feed</html>")).toEqual([]);
    expect(parseFeed("")).toEqual([]);
    const many = Array.from({ length: 100 }, (_, i) => `<item><title>T${i}</title><link>https://e.ng/${i}</link></item>`).join("");
    expect(parseFeed(many, 10)).toHaveLength(10);
  });
});

describe("helpers", () => {
  it("decodes numeric and named entities, and leaves unknown ones", () => {
    expect(decodeEntities("A &amp; B &#8217; &#x41; &unknown;")).toBe("A & B ’ A &unknown;");
  });
  it("labels how old a headline is", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(agoLabel("2026-10-01T11:30:00Z", now)).toBe("less than an hour ago");
    expect(agoLabel("2026-10-01T09:00:00Z", now)).toBe("3 hours ago");
    expect(agoLabel("2026-09-29T12:00:00Z", now)).toBe("2 days ago");
    expect(agoLabel("2026-10-02T12:00:00Z", now)).toBe("just now");
  });
});

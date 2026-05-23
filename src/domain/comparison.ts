import type { FlightSample, FlightSummary, PlatformName, PlatformQuote, PriceComparisonSummary } from "./types";

const flightSummaryPlatforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

function comparisonQuotes(quotes: PlatformQuote[]) {
  return quotes.filter((quote) => flightSummaryPlatforms.includes(quote.platform));
}

function availableQuotes(quotes: PlatformQuote[]) {
  return comparisonQuotes(quotes).filter((quote) => quote.available && typeof quote.price === "number");
}

function formatGap(gap: number) {
  return `${Math.abs(gap)}元`;
}

export function summarizeQuoteSet(quotes: PlatformQuote[]): PriceComparisonSummary {
  const available = availableQuotes(quotes);
  const competitors = available.filter((quote) => quote.platform !== "青猫差旅");
  const qingmao = quotes.find((quote) => quote.platform === "青猫差旅");
  const qingmaoPrice = qingmao?.available ? qingmao.price : null;
  const lowestOverall = [...available].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];

  if (typeof qingmaoPrice !== "number" || !competitors.length) {
    return {
      lowestPlatform: "",
      qingmaoGap: null,
      comparisonBasis: "unavailable",
      comparisonLabel: "暂无完整可比价格",
      competitorCount: competitors.length,
      conclusion: "青猫差旅或其他平台暂无完整可比价格。"
    };
  }

  const competitorPrices = competitors.map((quote) => quote.price ?? 0);
  const competitorCount = competitors.length;
  const qingmaoIsLowest = available.every((quote) => quote.platform === "青猫差旅" || qingmaoPrice <= (quote.price ?? Infinity));
  const basis = qingmaoIsLowest ? "highestCompetitor" : "averageCompetitor";
  const referencePrice = qingmaoIsLowest
    ? Math.max(...competitorPrices)
    : Math.round(competitorPrices.reduce((sum, price) => sum + price, 0) / competitorCount);
  const qingmaoGap = qingmaoPrice - referencePrice;
  const targetLabel = basis === "highestCompetitor" ? `另外${competitorCount}家平台最高价` : `另外${competitorCount}家平台平均价`;
  let conclusion = "";
  let comparisonLabel = "";

  if (qingmaoGap < 0) {
    comparisonLabel = `对比${targetLabel}低了${formatGap(qingmaoGap)}`;
    conclusion = `青猫差旅${comparisonLabel}。`;
  } else if (qingmaoGap === 0) {
    comparisonLabel = `对比${targetLabel}持平`;
    conclusion = `青猫差旅${comparisonLabel}。`;
  } else {
    comparisonLabel = `对比${targetLabel}高了${formatGap(qingmaoGap)}`;
    conclusion = `青猫差旅${comparisonLabel}。`;
  }

  return {
    lowestPlatform: lowestOverall?.platform as PlatformName,
    qingmaoGap,
    comparisonBasis: basis,
    comparisonLabel,
    conclusion,
    competitorCount
  };
}

export function summarizeFlight(sample: FlightSample): FlightSummary {
  const available = availableQuotes(sample.quotes);
  const summary = summarizeQuoteSet(sample.quotes);

  if (summary.qingmaoGap === null) {
    return {
      sampleId: sample.id,
      ...summary,
      availablePlatformCount: available.length,
      evidenceCount: comparisonQuotes(sample.quotes).filter((quote) => quote.evidencePath).length
    };
  }

  return {
    sampleId: sample.id,
    lowestPlatform: summary.lowestPlatform,
    qingmaoGap: summary.qingmaoGap,
    comparisonBasis: summary.comparisonBasis,
    comparisonLabel: summary.comparisonLabel,
    availablePlatformCount: available.length,
    evidenceCount: comparisonQuotes(sample.quotes).filter((quote) => quote.evidencePath).length,
    conclusion: summary.conclusion
  };
}

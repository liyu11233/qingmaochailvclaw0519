import type { FlightSample, FlightSummary, PlatformName, PlatformQuote, PriceComparisonSummary } from "./types";

const flightSummaryPlatforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];

function comparisonQuotes(quotes: PlatformQuote[]) {
  return quotes.filter((quote) => flightSummaryPlatforms.includes(quote.platform));
}

function availableQuotes(quotes: PlatformQuote[]) {
  return comparisonQuotes(quotes).filter((quote) => quote.available && typeof quote.price === "number");
}

function formatGap(gap: number) {
  const value = Math.abs(gap);
  const normalized = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  return `${normalized}元`;
}

export function summarizeQuoteSet(quotes: PlatformQuote[]): PriceComparisonSummary {
  const available = availableQuotes(quotes);
  const competitors = available.filter((quote) => quote.platform !== "青猫差旅");
  const qingmao = quotes.find((quote) => quote.platform === "青猫差旅");
  const qingmaoPrice = qingmao?.available ? qingmao.price : null;
  const lowestOverall = [...available].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];

  if (typeof qingmaoPrice !== "number" || competitors.length < 3) {
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
  const lowestCompetitorPrice = Math.min(...competitorPrices);
  const highestCompetitorPrice = Math.max(...competitorPrices);
  const qingmaoVsLowest = qingmaoPrice - lowestCompetitorPrice;
  const qingmaoVsHighest = qingmaoPrice - highestCompetitorPrice;
  let basis: PriceComparisonSummary["comparisonBasis"] = "lowestCompetitor";
  let qingmaoGap = qingmaoVsLowest;
  let conclusion = "";
  let comparisonLabel = "";

  if (qingmaoPrice <= lowestCompetitorPrice) {
    basis = "lowestCompetitor";
    qingmaoGap = qingmaoVsLowest;
    if (qingmaoGap < 0) {
      comparisonLabel = `对比另外${competitorCount}家平台最低价低了${formatGap(qingmaoGap)}`;
    } else {
      comparisonLabel = `与另外${competitorCount}家平台最低价持平`;
    }
    conclusion = `青猫差旅${comparisonLabel}。`;
  } else if (qingmaoPrice >= highestCompetitorPrice) {
    basis = "highestCompetitor";
    qingmaoGap = qingmaoVsHighest;
    if (qingmaoGap > 0) {
      comparisonLabel = `对比另外${competitorCount}家平台最高价高了${formatGap(qingmaoGap)}`;
    } else {
      comparisonLabel = `与另外${competitorCount}家平台最高价持平`;
    }
    conclusion = `青猫差旅${comparisonLabel}。`;
  } else {
    basis = "betweenCompetitors";
    qingmaoGap = qingmaoVsLowest;
    comparisonLabel = `对比另外${competitorCount}家平台最低价高了${formatGap(qingmaoVsLowest)}，但比另外${competitorCount}家平台最高价低了${formatGap(qingmaoVsHighest)}`;
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
